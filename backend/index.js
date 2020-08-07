const os = require('os');
const fs = require('fs');
const promisify = require('util').promisify;
const Koa = require('koa');
const Router = require('koa-router');
const config = require('config');
const mysql = require('mysql2/promise');
const request = require('request-promise');
const nodemailer = require('nodemailer');
const aws = require('aws-sdk');
const hummus = require('hummus');
const { v4: uuidv4 } = require('uuid');
const sha3 = require('js-sha3');
const privateToAccount = require('ethjs-account').privateToAccount;
const koaBody = require('koa-body');
const logger = require('koa-logger');
const streams = require('memory-streams');
const cors = require('@koa/cors');
const Stripe = require('stripe');
const { IncomingWebhook } = require('@slack/client');
global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const { SpaceClient } = require('@fleekhq/space-client');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const app = module.exports = new Koa();
const router = new Router();
const stripe = new Stripe(config.get('stripe').secret);
const slackDataHook = new IncomingWebhook(config.get('slack_hooks').data);
const slackErrorHook = new IncomingWebhook(config.get('slack_hooks').error);
const slackStripeHook = new IncomingWebhook(config.get('slack_hooks').stripe);

const apiPrefix = config.get('api_prefix');
const ethvigil_api = JSON.parse(JSON.stringify(config.get('ethvigil_api')));
var spaceClient;

if (!process.env.TESTS) {
	spaceClient = new SpaceClient(config.get('spaceDaemon'));
	var mysqlPool = mysql.createPool(config.get('mysql'));
	var sesConfig = JSON.parse(JSON.stringify(config.get('ses'))); //aws sdk doesn't like the object from config
	mysqlPool.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
		if (error) throw error;
	});

	var transporter = nodemailer.createTransport({
		SES: new aws.SES({
			apiVersion: '2010-12-01',
			region: sesConfig.region,
			credentials: sesConfig,
			sendingRate: 10
		})
	});
	var s3Config = JSON.parse(JSON.stringify(config.get('s3'))); //aws sdk doesn't like the object from config
	var s3 = new aws.S3({
		apiVersion: '2010-12-01',
		region: s3Config.region,
		credentials: s3Config
	});
}

router.get(apiPrefix+'/', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: true
	}
});

router.get(apiPrefix+'/check', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: true,
		data: {
			message: 'Hello World'
		}
	}
});

router.post(apiPrefix+'/confirm', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	var [docRequest] = await mysqlPool.execute('SELECT * FROM docs WHERE token = ?', [ctx.request.body.token]);
	if (docRequest.length == 0){
		logError('doc not found', ctx.request.body.token);
		ctx.body.error = 'notfound';
		ctx.status = 404;
		return;
	}
	docRequest = docRequest[0];
	if (docRequest.status != 'unconfirmed'){
		logError('doc already confirmed', ctx.request.body.token);
		ctx.body.error = docRequest.status;
		ctx.status = 400;
		return;
	}
	docRequest.sender = JSON.parse(docRequest.sender);
	if (docRequest.stripeCustomer){
		if (docRequest.plan == 'monthly'){
			try {
				const subscription = await stripe.subscriptions.create({
					customer: docRequest.stripeCustomer,
					trial_from_plan: true,
					items: [{
						plan: config.get('stripe').plans.monthly
					}]
				});
				console.log(subscription.id);
				const [insertSubsription] = await mysqlPool.query('INSERT into stripe_subscriptions SET ?', {
					subscription_id: subscription.id,
					doc_id: docRequest.id,
					email: docRequest.sender.email,
					ctime: parseInt(+new Date()/1000)
				});
			}
			catch (e){
				logError('stripe', e);
				ctx.body.error = 'stripe';
				ctx.status = 400;
				sendToSlack('stripe', 'Coud not subscribe customer '+docRequest.stripeCustomer);
				return;
			}
		} else {
			try {
				const charge = await stripe.charges.create({
					customer: docRequest.stripeCustomer,
					amount: 100,
					currency: 'USD',
					description: 'BlockSig - Pay as you go Fee',
					statement_descriptor: 'BlockSig.app',
					capture: false
				});
				console.log(charge.id);
				const [insertCharge] = await mysqlPool.query('INSERT into stripe_charges SET ?', {
					charge_id: charge.id,
					doc_id: docRequest.id,
					email: docRequest.sender.email,
					ctime: parseInt(+new Date()/1000)
				});
			}
			catch (e){
				logError('stripe', e);
				ctx.body.error = 'stripe';
				ctx.status = 400;
				sendToSlack('stripe', 'Coud not charge customer '+docRequest.stripeCustomer);
				return;
			}
		}
	}
	const [confirmDoc] = await mysqlPool.query('UPDATE docs SET status="confirmed" WHERE id = ?', docRequest.id);
	docRequest.signers = JSON.parse(docRequest.signers);
	var signerHashes = [];
	for (i in docRequest.signers){
		let token = uuidv4();
		let address = privateToAccount(sha3.keccak256(docRequest.token+docRequest.signers[i].email)).address.toLowerCase();
		var [insertSigner] = await mysqlPool.query('INSERT into requests SET ?', {
			token: token,
			doc_id: docRequest.id,
			address: address.substr(2),
			signer_id: i
		});
		if (!docRequest.notarize || docRequest.signers[i].email != docRequest.sender.email){
			signerHashes.push(address);
		}
	}
	var response;
	try {
		var network;
		switch (docRequest.plan){
			case 'free':
				network = 'testnet';
			break;
			default:
				network = 'mainnet';
			break;
		}
		response = await request.post({
			url: ethvigil_api[network].prefix+'/createDoc',
			headers: {'x-api-key': ethvigil_api[network].key},
			body: {
				hash: '0x'+docRequest.orig_hash,
				notarize: (docRequest.notarize == 1),
				signers: JSON.stringify(signerHashes)
			},
			json: true
		});
	}
	catch (e){
		logError('ethvigil', e);
		ctx.body.error = 'ethvigil';
		ctx.status = 400;
		return;
	}
	if (!response.success){
		logError('ethvigil', response);
		ctx.body.error = 'ethvigil';
		ctx.status = 400;
		return;
	}
	const [txDoc] = await mysqlPool.query('UPDATE docs SET txHash=? WHERE id = ?', [response.data[0].txHash.substr(2), docRequest.id]);
	body = {
		success: true
	}
});

router.post(apiPrefix+'/notarize', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	var [docRequest] = await mysqlPool.execute('SELECT * FROM docs WHERE token = ?', [ctx.request.body.token]);
	if (docRequest.length == 0){
		logError('doc not found', ctx.request.body.token);
		ctx.body.error = 'notfound';
		ctx.status = 404;
		return;
	}
	docRequest = docRequest[0];
	if (docRequest.status != 'pendingnotary'){
		logError('doc already notarized', ctx.request.body.token, docRequest.status);
		ctx.body.error = docRequest.status;
		ctx.status = 400;
		return;
	}
	docRequest.sender = JSON.parse(docRequest.sender);
	docRequest.signers = JSON.parse(docRequest.signers);
	docRequest.signatures = JSON.parse(docRequest.signatures);
	var network;
	switch (docRequest.plan){
		case 'free':
			network = 'testnet';
		break;
		default:
			network = 'mainnet';
		break;
	}
	/*
	var params = {
		Bucket: config.get('s3').bucket,
		Key: 'bsfiles/'+docRequest.token+'.pdf'
	};
	var s3Response = await s3.getObject(params).promise();
	*/
	const signedFile = await spaceClient.openFile({
		path: docRequest.token+'.pdf',
	});
	var writer = new streams.WritableStream();
	//var reader = new hummus.PDFRStreamForBuffer(new Buffer(s3Response.Body));
	var reader = new hummus.PDFRStreamForBuffer(await readFile(signedFile.getLocation()));
	var pdfWriter = hummus.createWriterToModify(reader, new hummus.PDFStreamForResponse(writer));
	var [signatureBlocks] = await mysqlPool.execute('SELECT signer_id, token, btime FROM requests WHERE doc_id = ?', [docRequest.id]);
	for (var i=0; i<signatureBlocks.length; i++){
		docRequest.signers[signatureBlocks[i].signer_id].token = signatureBlocks[i].token;
		docRequest.signers[signatureBlocks[i].signer_id].btime = signatureBlocks[i].btime;
	}
	var pageModifier = new hummus.PDFPageModifier(pdfWriter,0);
	var pageTop = pdfWriter.getModifiedFileParser().parsePage(0).getMediaBox()[3];
	var sortedSigs = {};
	for (i in docRequest.signatures){
		if (sortedSigs[docRequest.signatures[i].page-1] == undefined){
			sortedSigs[docRequest.signatures[i].page-1] = [];
		}
		sortedSigs[docRequest.signatures[i].page-1].push(docRequest.signatures[i]);
	}
	var textOptions = {
		font: pdfWriter.getFontForFile(__dirname + '/arial.ttf'),
		size: 8,
		colorspace: 'gray',
		color: 0x00,
	};
	for (i in sortedSigs) {
		pageModifier = new hummus.PDFPageModifier(pdfWriter, parseInt(i), true);
		for (j in sortedSigs[i]){
			var left = parseInt(sortedSigs[i][j].position.left/1.5);
			var top = parseInt(pageTop-53-sortedSigs[i][j].position.top/1.5);
			/*
			params = {
				Bucket: config.get('s3').bucket,
				Key: 'bsfiles/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png'
			};
			s3Response = await s3.getObject(params).promise();
			//#FIXME Need to switch to FormXObject so we can use memory streams instead of files here
			await writeFile(os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', new Buffer(s3Response.Body));
			*/
			const openFileRes = await spaceClient.openFile({
				path: docRequest.signers[sortedSigs[i][j].signer].token+'.png'
			});
			await writeFile(os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', await readFile(openFileRes.getLocation()));
			pageModifier.startContext().getContext().drawImage(left, top, os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', {
				transformation: {
					width: 160,
					height: 53
				}
			});
			textOptions.size = 8;
			top -= 6;
			pageModifier.startContext().getContext().writeText(docRequest.signers[sortedSigs[i][j].signer].name, left, top, textOptions);
			textOptions.size = 6;
			top -= 5;
			pageModifier.startContext().getContext().writeText(docRequest.signers[sortedSigs[i][j].signer].email, left, top, textOptions);
			pageModifier.endContext().writePage();
			fs.unlink(os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', (err) => {
				if (err){
					logError('file delete', err);
				}
			});
		}
	}
	pageModifier = new hummus.PDFPageModifier(pdfWriter, pdfWriter.getModifiedFileParser().getPagesCount()-1);
	var y = 755;
	var x = 25;
	for (i in docRequest.signers){
		textOptions.size = 12;
		pageModifier.startContext().getContext().writeText('Document Signed by '+docRequest.signers[i].name+'('+docRequest.signers[i].email+')', x, y, textOptions);
		y -= 15;
		textOptions.size = 8;
		pageModifier.startContext().getContext().writeText('Timestamp: '+(new Date(docRequest.signers[i].btime*1000)), x, y, textOptions);
		y -= 35;
		if (y < 50){
			//Run out of space on page, let's create a new one
			pageModifier.endContext().writePage();
			var page = pdfWriter.createPage(0,0,595,842);
			pdfWriter.writePage(page);
			pdfWriter.end();
			reader = new hummus.PDFRStreamForBuffer(writer.toBuffer());
			writer = new streams.WritableStream();
			pdfWriter = hummus.createWriterToModify(reader, new hummus.PDFStreamForResponse(writer));
			textOptions = {
				font: pdfWriter.getFontForFile(__dirname + '/arial.ttf'),
				size: 12,
				colorspace: 'gray',
				color: 0x00,
			};
			pageModifier = new hummus.PDFPageModifier(pdfWriter, pdfWriter.getModifiedFileParser().getPagesCount()-1);
			y = 755;
		}
	}
	textOptions.size = 12;
	pageModifier.startContext().getContext().writeText('Document Notarized by '+docRequest.sender.name+'('+docRequest.sender.email+')', x, y, textOptions);
	y -= 15;
	textOptions.size = 8;
	pageModifier.startContext().getContext().writeText('Timestamp: '+(new Date()), x, y, textOptions);
	y -= 35;
	textOptions.size = 14;
	pageModifier.startContext().getContext().writeText('Verfication - '+config.get('frontend_prefix')+'/verify.html', x, y, textOptions);
	pageModifier.endContext().writePage();
	var infoDictionary = pdfWriter.getDocumentContext().getInfoDictionary();
	infoDictionary.creator = 'BlockSig_'+docRequest.token;
	infoDictionary.addAdditionalInfoEntry('BlockSigData', JSON.stringify({
		token: docRequest.token,
		ethvigil_api_prefix: ethvigil_api[network].prefix,
		sender: docRequest.sender,
		signers: docRequest.signers
	}));
	pdfWriter.end();
	writer = writer.toBuffer()
	const finalHash = sha3.keccak256(writer);
	/*
	//store the file on S3
	var params = {
		Bucket: config.get('s3').bucket,
		Key: 'bsfiles/'+docRequest.token+'_signed.pdf',
		Body: writer
	};
	var s3Response = await s3.putObject(params).promise();
	*/
	await writeFile(os.tmpdir()+'/'+docRequest.token+'_signed.pdf', writer);
	try {
		await spaceClient.addItems({
			targetPath: '/',
			sourcePaths: [os.tmpdir()+'/'+docRequest.token+'_signed.pdf']
		});
	}
	catch (e){
		logError('space', e);
		ctx.body.error = 'space';
		ctx.status = 400;
		return;
	}
	const [signedDoc] = await mysqlPool.query('UPDATE docs SET status="signed" WHERE id = ?', docRequest.id);
	var response = await request.post({
		url: ethvigil_api[network].prefix+'/finalizeDoc',
		headers: {'x-api-key': ethvigil_api[network].key},
		form: {
			originalHash: '0x'+docRequest.orig_hash,
			finalHash: '0x'+finalHash
		},
		json: true
	});
	if (!response.success){
		logError('ethvigil', response);
		ctx.body.error = 'ethvigil';
		ctx.status = 400;
		return;
	}
	ctx.body = {
		success: true
	}
});

router.post(apiPrefix+'/submit', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	ctx.request.body = JSON.parse(ctx.request.body.json);
	const docToken = uuidv4();
	if (ctx.request.body.stripeToken){
		try {
			const customer = await stripe.customers.create({
				source: ctx.request.body.stripeToken,
				description: 'Document Token - '+docToken,
				email: ctx.request.body.sender.email
			});
			ctx.request.body.stripeToken = customer.id;
			sendToSlack('stripe', 'Paid signup ('+ctx.request.body.plan+') from '+ctx.request.body.sender.email);
		}
		catch (e){
			logError('stripe', e);
			ctx.body.error = 'stripe';
			ctx.status = 400;
			return;
		}
	} else {
		// we can ignore recaptcha if we have stripe token
		if (config.get('recaptcha')){
			var response = await request.post({url: 'https://www.google.com/recaptcha/api/siteverify', form: {
				secret: config.get('recaptcha'),
				response: ctx.request.body.recaptchaToken,
				remoteip: ctx.ip
			}});
			response = JSON.parse(response);
			if (!response.success){
				logError('recaptcha', response);
				ctx.body.error = 'recaptcha';
				ctx.status = 400;
				return;
			}
			ctx.request.body.plan = 'free';
		}
	}
	var network, mailPrefix = '';
	switch (ctx.request.body.plan){
		case 'free':
			network = 'testnet';
			mailPrefix = '] [Testnet';
		break;
		default:
			network = 'mainnet';
		break;
	}
	var writer = new streams.WritableStream();
	var reader = new hummus.PDFRStreamForBuffer(await readFile(ctx.request.files.document.path));
	var pdfWriter = hummus.createWriterToModify(reader, new hummus.PDFStreamForResponse(writer));
	var page = pdfWriter.createPage(0,0,595,842);
	var cxt = pdfWriter.startPageContentContext(page);
	var textOptions = {
		font: pdfWriter.getFontForFile(__dirname + '/arial.ttf'),
		size: 14,
		colorspace: 'gray',
		color: 0x00,
	};
	cxt.writeText('BlockSig Document ID: '+docToken, 25, 805, textOptions);
	var infoDictionary = pdfWriter.getDocumentContext().getInfoDictionary();
	infoDictionary.creator = 'BlockSig_'+docToken;
	infoDictionary.addAdditionalInfoEntry('BlockSigData', JSON.stringify({
		token: docToken,
		ethvigil_api_prefix: ethvigil_api[network].prefix,
		sender: ctx.request.body.sender,
		signers: ctx.request.body.signers
	}));
	pdfWriter.writePage(page);
	pdfWriter.end();
	writer = writer.toBuffer()
	const origHash = sha3.keccak256(writer);
	console.log('got hash for', docToken, origHash)
	await writeFile(os.tmpdir()+'/'+docToken+'.pdf', writer);
	const stream = await spaceClient.addItems({
		targetPath: '/', // path in the bucket to be saved
		sourcePaths: [os.tmpdir()+'/'+docToken+'.pdf']
	});
	console.log('uploaded to space daemon');
	/*
	stream.on('data', (data) => {
		console.log('data: ', data);
	});

	stream.on('error', (error) => {
		console.error('error: ', error);
	});

	stream.on('end', () => {
		console.log('end');
	});
	*/
	/*
	//store the file on S3
	const params = {
		Bucket: config.get('s3').bucket,
		Key: 'bsfiles/'+docToken+'.pdf',
		Body: writer
	};
	const s3Response = await s3.putObject(params).promise();
	*/
	const [insertDoc] = await mysqlPool.query('INSERT into docs SET ?', {
		//url: config.get('s3').bucket+'//bsfiles/'+docToken+'.pdf',
		url: config.get('spaceDaemon').defaultBucket+'/'+docToken+'.pdf',
		name: ctx.request.body.docName,
		orig_hash: origHash,
		token: docToken,
		signers: JSON.stringify(ctx.request.body.signers),
		plan: ctx.request.body.plan,
		stripeCustomer: ctx.request.body.stripeToken,
		signatures: JSON.stringify(ctx.request.body.signatures),
		sender: JSON.stringify(ctx.request.body.sender),
		notarize: ctx.request.body.notarize,
		ctime: parseInt(+new Date()/1000)
	});
	//send out email to sender for confirmation
	var _html = await readFile(__dirname+'/emails/confirm.html');
	_html = _html.toString().replace('__name__', ctx.request.body.sender.name).replace('__confirmUrl__', config.get('frontend_prefix')+'/confirm.html?'+docToken);
	var mailOptions = {
		from: sesConfig.from,
		to: ctx.request.body.sender.email,
		subject: (config.get('dev') ? 'DEV - ' : '')+'[BlockSig'+mailPrefix+'] Confirm Request for - '+ctx.request.body.docName,
		text: config.get('frontend_prefix')+'/confirm.html?'+docToken,
		html: _html
		//html: '<p>'+config.get('frontend_prefix')+'/confirm.html?'+docToken+'</p>'
	};
	transporter.sendMail(mailOptions, (error, info) => {
		if (error){
			logError('email', error);
		} else {
			console.log(info);
		}
	});
	//delete the uploaded file
	fs.unlink(os.tmpdir()+'/'+docToken+'.pdf', (err) => {
		if (err){
			logError('file delete', error);
		}
	});
	fs.unlink(ctx.request.files.document.path, (err) => {
		if (err){
			logError('file delete', error);
		}
	});
	ctx.body = {
		success: true
	}
});

router.get(apiPrefix+'/viewDoc/:token', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	var [docRequest] = await mysqlPool.execute('SELECT * FROM docs WHERE token = ?', [ctx.params.token]);
	if (docRequest.length == 0){
		logError('Missing document', ctx.params.token);
		ctx.body.error = 'notfound';
		ctx.status = 404;
		return;
	}
	docRequest = docRequest[0];
	if (docRequest.status == 'canceled'){
		logError('Canceled document', ctx.params.token);
		ctx.body.error = docRequest.status;
		ctx.status = 400;
		return;
	}
	/*
	const params = {
		Bucket: config.get('s3').bucket,
		Key: 'bsfiles/'+docRequest.token+'.pdf'
	};
	try {
		const s3Response = await s3.getObject(params).promise();
		ctx.type = 'application/pdf';
		ctx.body = new Buffer(s3Response.Body);
	}
	catch (e){
		logError('s3', e);
		ctx.body.error = 'notfound';
		ctx.status = 400;
		return;
	}
	*/
	const openFileRes = await spaceClient.openFile({
		path: ctx.params.token+'.pdf',
	});
	const location = openFileRes.getLocation();
	console.log(location);
	ctx.type = 'application/pdf';
	ctx.body = await readFile(location);
});

router.get(apiPrefix+'/getDoc/:token', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	const sigRequest = await getSigRequest(ctx, ctx.params.token);
	if (!sigRequest){
		return;
	}
	/*
	const params = {
		Bucket: config.get('s3').bucket,
		Key: 'bsfiles/'+sigRequest.doc_token+'.pdf'
	};
	try {
		const s3Response = await s3.getObject(params).promise();
		ctx.type = 'application/pdf';
		ctx.body = new Buffer(s3Response.Body);
	}
	catch (e){
		logError('S3', e);
		ctx.body.error = 'notfound';
		ctx.status = 400;
		return;
	}
	*/
	const openFileRes = await spaceClient.openFile({
		path: sigRequest.doc_token+'.pdf',
	});
	const location = openFileRes.getLocation();
	console.log(location);
	ctx.type = 'application/pdf';
	ctx.body = await readFile(location);
});

router.get(apiPrefix+'/getSignatures/:token', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	const sigRequest = await getSigRequest(ctx, ctx.params.token);
	if (!sigRequest){
		return;
	}
	ctx.body = {
		success: true,
		data: {
			signer_id: sigRequest.signer_id,
			signers: JSON.parse(sigRequest.signers),
			signatures: JSON.parse(sigRequest.signatures)
		}
	}
});

router.post(apiPrefix+'/sign', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	const sigRequest = await getSigRequest(ctx, ctx.request.body.token);
	if (!sigRequest){
		return;
	}
	sigRequest.signers = JSON.parse(sigRequest.signers);
	var response;
	var network;
	switch (sigRequest.plan){
		case 'free':
			network = 'testnet';
		break;
		default:
			network = 'mainnet';
		break;
	}
	ctx.request.body.signatureData = new Buffer(ctx.request.body.signatureData.replace(/^data:image\/png;base64,/, ""), 'base64');
	var notarized = sigRequest.notarize && sigRequest.signer_id == 0;
	try {
		response = await request.post({
			url: ethvigil_api[network].prefix+'/sign',
			headers: {'x-api-key': ethvigil_api[network].key},
			body: {
				hash: '0x'+sigRequest.orig_hash,
				signatureHash: '0x'+sha3.keccak256(ctx.request.body.signatureData),
				notarized: notarized,
				signer: privateToAccount(sha3.keccak256(sigRequest.doc_token+sigRequest.signers[sigRequest.signer_id].email)).address.toLowerCase()
			},
			json: true
		});
	}
	catch (e){
		logError('ethvigil', e);
		ctx.body.error = 'ethvigil';
		ctx.status = 400;
		return;
	}
	if (!response.success){
		logError('ethvigil', response);
		ctx.body.error = 'ethvigil';
		ctx.status = 400;
		return;
	}
	const [sign] = await mysqlPool.query('UPDATE requests SET ? WHERE id = ?', [{
		txHash: response.data[0].txHash.substr(2),
		status: 'signed',
		stime: parseInt(+new Date()/1000)
	}, sigRequest.id]);
	/*
	//store the signature on S3
	const params = {
		Bucket: config.get('s3').bucket,
		Key: 'bsfiles/'+sigRequest.token+'.png',
		Body: new Buffer(ctx.request.body.signatureData, 'base64')
	};
	try {
		const s3Response = await s3.putObject(params).promise();
	}
	catch (e){
		logError('s3', e);
		ctx.body.error = 's3';
		ctx.status = 400;
		return;
	}
	*/
	await writeFile(os.tmpdir()+'/'+sigRequest.token+'.png', ctx.request.body.signatureData)
	const stream = await spaceClient.addItems({
		targetPath: '/',
		sourcePaths: [os.tmpdir()+'/'+sigRequest.token+'.png']
	});
	ctx.body = {
		success: true,
		notarized: notarized,
		data: ctx.request.body
	}
});

router.get(apiPrefix+'/view/:token', async (ctx) => {
	ctx.type = 'application/json';
	ctx.body = {
		success: false
	}
	var [docRequest] = await mysqlPool.execute('SELECT * FROM docs WHERE token = ?', [ctx.params.token]);
	if (docRequest.length == 0){
		logError('Missing document', ctx.params.token);
		ctx.body.error = 'notfound';
		ctx.status = 404;
		return;
	}
	docRequest = docRequest[0];
	if (docRequest.status == 'canceled'){
		logError('Document Canceled', ctx.params.token);
		ctx.body.error = docRequest.status;
		ctx.status = 400;
		return;
	}
	docRequest.signers = JSON.parse(docRequest.signers);
	docRequest.signatures = JSON.parse(docRequest.signatures);
	ctx.body = {
		success: true,
		data: docRequest
	}
})

router.post(apiPrefix+'/hook', async (ctx) => {
	ctx.type = 'application/json';
	if (ctx.request.body.data){
		console.log('hook registration');
		ctx.body = {
			success: true
		}
		return;
	}
	if (!ctx.request.body.event_name){
		if (!ctx.request.body.status){
			logError('transaction failed', ctx.request.body.txHash);
			var [docRequest] = await mysqlPool.execute('SELECT * FROM docs WHERE txHash = ?', [ctx.request.body.txHash.substr(2)]);
			if (docRequest.length > 0){
				logError('ethvigil tx error for doc?', ctx.request.body.txHash);
				return;
			}
			var [sigRequest] = await mysqlPool.execute('SELECT sr.*, d.name as docName, d.url, d.orig_hash, d.token as doc_token, d.sender, d.signatures, d.signers, d.notarize FROM requests as sr, docs as d WHERE sr.txHash = ? AND d.id=sr.doc_id', [ctx.request.body.txHash.substr(2)]);
			if (sigRequest.length > 0){
				sigRequest = sigRequest[0];
				if (sigRequest.prevHash){
					logError('sig failed previously, investigate', sigRequest);
					ctx.body = {
						success: true
					}
					return;
				}
				logError('failed tx for sig', sigRequest[0].id);
				sigRequest.signers = JSON.parse(sigRequest.signers);
				var network;
				switch (sigRequest.plan){
					case 'free':
						network = 'testnet';
					break;
					default:
						network = 'mainnet';
					break;
				}
				var response = await request.post({
					url: ethvigil_api[network].prefix+'/sign',
					headers: {'x-api-key': ethvigil_api[network].key},
					form: {
						hash: '0x'+sigRequest.orig_hash,
						signer: privateToAccount(sha3.keccak256(sigRequest.doc_token+sigRequest.signers[sigRequest.signer_id].email)).address.toLowerCase()
					}
				});
				response = JSON.parse(response);
				if (!response.success){
					logError('ethvigil error', response);
					ctx.body.error = 'ethvigil';
					ctx.status = 400;
					return;
				}
				const [sign] = await mysqlPool.query('UPDATE requests SET ? WHERE id = ?', [{
					txHash: response.data[0].txHash.substr(2),
					prevHash: sigRequest.txHash,
					stime: parseInt(+new Date()/1000)
				}, sigRequest.id]);
				return;
			}
			logError('found no matching hashes', ctx.request.body.txHash);
		} else {
			console.log('transaction got mined', ctx.request.body.txHash);
		}
		ctx.body = {
			success: true
		}
		return;
	}
	ctx.body = {
		success: false
	}
	var [docRequest] = await mysqlPool.execute('SELECT * FROM docs WHERE orig_hash = ?', [ctx.request.body.event_data ? ctx.request.body.event_data.hash.substr(2) : '']);
	if (docRequest.length == 0){
		logError('unknown hash', ctx.request.body.txHash);
		ctx.body.error = 'unknown hash';
		return;
	}
	console.log('eventName', ctx.request.body.event_name);
	docRequest = docRequest[0];
	docRequest.sender = JSON.parse(docRequest.sender);
	docRequest.signers = JSON.parse(docRequest.signers);
	docRequest.signatures = JSON.parse(docRequest.signatures);
	var network, mailPrefix = '';
	switch (docRequest.plan){
		case 'free':
			network = 'testnet';
			mailPrefix = '] [Testnet';
		break;
		default:
			network = 'mainnet';
		break;
	}

	switch (ctx.request.body.event_name){
		case 'Signature':
			console.log('doc signature propagated', docRequest.token)
			var [sigRequest] = await mysqlPool.query('UPDATE requests SET btime= ?, status="propagated" WHERE doc_id = ? AND address = ?', [parseInt(+new Date()/1000), docRequest.id, ctx.request.body.event_data.signer.toLowerCase().substr(2)]);
		break;
		case 'Created':
			let signerLength = Object.keys(docRequest.signers).length;
			if (signerLength == 0){
				/*
				var params = {
					Bucket: config.get('s3').bucket,
					Key: 'bsfiles/'+docRequest.token+'.pdf'
				};
				var s3Response = await s3.getObject(params).promise();
				*/
				const openFileRes = await spaceClient.openFile({
					path: docRequest.token+'.pdf'
				});
				var _html = await readFile(__dirname+'/emails/completed.html');
				_html = _html.toString().replace('__name__', docRequest.sender.name).replace('__verifyUrl__', config.get('frontend_prefix')+'/verify.html?');
				var mailOptions = {
					from: sesConfig.from,
					to: docRequest.sender.email,
					subject: (config.get('dev') ? 'DEV - ' : '')+'[BlockSig'+mailPrefix+'] Document Ready - '+docRequest.name,
					text: 'The [attached] document is now on the blockchain. Visit the following URL to verify proof: '+config.get('frontend_prefix')+'/verify.html',
					html: _html,
					attachments: [
						{
							filename: docRequest.name.replace('.', '')+'.pdf',
							content: await readFile(openFileRes.getLocation())
							//content: new Buffer(s3Response.Body)
						}
					]
				};
				transporter.sendMail(mailOptions, (error, info) => {
					if (error){
						logError('email', error);
					} else {
						console.log(info);
					}
				});
				docRequest.status = 'signed';
			} else {
				for (i in docRequest.signers){
					if (docRequest.notarize && docRequest.signers[i].email == docRequest.sender.email){
						continue;
					}
					var [sigRequest] = await mysqlPool.query('SELECT token FROM requests WHERE doc_id = ? AND signer_id = ?', [docRequest.id, i])
					if (sigRequest.length == 0){
						logError('no sigrequest', docRequest.id+' - '+i);
						break;
					}
					var token = sigRequest[0].token;
					var _html = await readFile(__dirname+'/emails/sign.html');
					_html = _html.toString().replace('__name__', docRequest.signers[i].name).replace('__senderName__', docRequest.sender.name).replace('__senderEmail__', docRequest.sender.email).replace('__signUrl__', config.get('frontend_prefix')+'/sign.html?'+token);
					var mailOptions = {
						from: sesConfig.from,
						to: docRequest.signers[i].email,
						subject: (config.get('dev') ? 'DEV - ' : '')+'[BlockSig'+mailPrefix+'] Signature Request for - '+docRequest.name,
						text: docRequest.sender.name+' ('+docRequest.sender.email+') has sent a document to e-sign via BlockSig: '+config.get('frontend_prefix')+'/sign.html?'+token,
						html: _html
					};
					transporter.sendMail(mailOptions, (error, info) => {
						if (error){
							logError('email', error);
						} else {
							console.log(info);
						}
					});
				}
				if (!docRequest.notarize || signerLength != 1){
					docRequest.status = 'pending';
				}
			}
			if (docRequest.status != 'confirmed'){
				const [confirmDoc] = await mysqlPool.query('UPDATE docs SET status="'+docRequest.status+'" WHERE id = ?', docRequest.id);
				break;
			}
			console.log('skipping to notarization step');
		case 'Notarized':
		case 'Signed':
			if (ctx.request.body.event_name == 'Notarized'){
				const [signedDoc] = await mysqlPool.query('UPDATE docs SET status="notarized" WHERE id = ?', docRequest.id);
			} else {
				if (docRequest.notarize){
					var [sigRequest] = await mysqlPool.query('SELECT token FROM requests WHERE doc_id = ? AND signer_id = 0', [docRequest.id])
					if (sigRequest.length == 0){
						logError('no sigrequest for sender', docRequest.id);
						break;
					}
					sigRequest = sigRequest[0];
					console.log('requires notarization');
					var _html = await readFile(__dirname+'/emails/notarize.html');
					_html = _html.toString().replace('__name__', docRequest.sender.name).replace('__notarizeUrl__', config.get('frontend_prefix')+'/sign.html?'+sigRequest.token);
					const [pendingnotary] = await mysqlPool.query('UPDATE docs SET status="pendingnotary" WHERE id = ?', docRequest.id);
					var mailOptions = {
						from: sesConfig.from,
						to: docRequest.sender.email,
						subject: (config.get('dev') ? 'DEV - ' : '')+'[BlockSig'+mailPrefix+'] Notarization Request for - '+docRequest.name,
						text: config.get('frontend_prefix')+'/notarize.html?'+docRequest.token,
						html: _html
					};
					transporter.sendMail(mailOptions, (error, info) => {
						if (error){
							logError('email', error);
						} else {
							console.log(info);
						}
					});
					break;
				}
				const [signedDoc] = await mysqlPool.query('UPDATE docs SET status="signed" WHERE id = ?', docRequest.id);
			}
			/*
			var params = {
				Bucket: config.get('s3').bucket,
				Key: 'bsfiles/'+docRequest.token+'.pdf'
			};
			var s3Response = await s3.getObject(params).promise();
			*/
			const signedFile = await spaceClient.openFile({
				path: docRequest.token+'.pdf',
			});
			var writer = new streams.WritableStream();
			//var reader = new hummus.PDFRStreamForBuffer(new Buffer(s3Response.Body));
			var reader = new hummus.PDFRStreamForBuffer(await readFile(signedFile.getLocation()));
			var pdfWriter = hummus.createWriterToModify(reader, new hummus.PDFStreamForResponse(writer));
			var [signatureBlocks] = await mysqlPool.execute('SELECT signer_id, token, btime FROM requests WHERE doc_id = ?', [docRequest.id]);
			for (var i=0; i<signatureBlocks.length; i++){
				docRequest.signers[signatureBlocks[i].signer_id].token = signatureBlocks[i].token;
				docRequest.signers[signatureBlocks[i].signer_id].btime = signatureBlocks[i].btime;
			}
			var pageModifier = new hummus.PDFPageModifier(pdfWriter,0);
			var pageTop = pdfWriter.getModifiedFileParser().parsePage(0).getMediaBox()[3];
			var sortedSigs = {};
			for (i in docRequest.signatures){
				if (sortedSigs[docRequest.signatures[i].page-1] == undefined){
					sortedSigs[docRequest.signatures[i].page-1] = [];
				}
				sortedSigs[docRequest.signatures[i].page-1].push(docRequest.signatures[i]);
			}
			var textOptions = {
				font: pdfWriter.getFontForFile(__dirname + '/arial.ttf'),
				size: 8,
				colorspace: 'gray',
				color: 0x00,
			};
			for (i in sortedSigs) {
				pageModifier = new hummus.PDFPageModifier(pdfWriter, parseInt(i), true);
				for (j in sortedSigs[i]){
					var left = parseInt(sortedSigs[i][j].position.left/1.5);
					var top = parseInt(pageTop-53-sortedSigs[i][j].position.top/1.5);
					/*
					params = {
						Bucket: config.get('s3').bucket,
						Key: 'bsfiles/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png'
					};
					s3Response = await s3.getObject(params).promise();
					//#FIXME Need to switch to FormXObject so we can use memory streams instead of files here
					await writeFile(os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', new Buffer(s3Response.Body));
					*/
					const openFileRes = await spaceClient.openFile({
						path: docRequest.signers[sortedSigs[i][j].signer].token+'.png'
					});
					await writeFile(os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', await readFile(openFileRes.getLocation()));
					pageModifier.startContext().getContext().drawImage(left, top, os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', {
						transformation: {
							width: 160,
							height: 53
						}
					});
					textOptions.size = 8;
					top -= 6;
					pageModifier.startContext().getContext().writeText(docRequest.signers[sortedSigs[i][j].signer].name, left, top, textOptions);
					textOptions.size = 6;
					top -= 5;
					pageModifier.startContext().getContext().writeText(docRequest.signers[sortedSigs[i][j].signer].email, left, top, textOptions);
					pageModifier.endContext().writePage();
					fs.unlink(os.tmpdir()+'/'+docRequest.signers[sortedSigs[i][j].signer].token+'.png', (err) => {
						if (err){
							logError('file delete', err);
						}
					});
				}
			}
			pageModifier = new hummus.PDFPageModifier(pdfWriter, pdfWriter.getModifiedFileParser().getPagesCount()-1);
			var y = 755;
			var x = 25;
			for (i in docRequest.signers){
				textOptions.size = 12;
				pageModifier.startContext().getContext().writeText('Document Signed by '+docRequest.signers[i].name+'('+docRequest.signers[i].email+')', x, y, textOptions);
				y -= 15;
				textOptions.size = 8;
				pageModifier.startContext().getContext().writeText('Timestamp: '+(new Date(docRequest.signers[i].btime*1000)), x, y, textOptions);
				y -= 35;
				if (y < 50){
					//Run out of space on page, let's create a new one
					pageModifier.endContext().writePage();
					var page = pdfWriter.createPage(0,0,595,842);
					pdfWriter.writePage(page);
					pdfWriter.end();
					reader = new hummus.PDFRStreamForBuffer(writer.toBuffer());
					writer = new streams.WritableStream();
					pdfWriter = hummus.createWriterToModify(reader, new hummus.PDFStreamForResponse(writer));
					textOptions = {
						font: pdfWriter.getFontForFile(__dirname + '/arial.ttf'),
						size: 12,
						colorspace: 'gray',
						color: 0x00,
					};
					pageModifier = new hummus.PDFPageModifier(pdfWriter, pdfWriter.getModifiedFileParser().getPagesCount()-1);
					y = 755;
				}
			}
			textOptions.size = 14;
			pageModifier.startContext().getContext().writeText('Document Finalized - '+config.get('frontend_prefix')+'/verify.html', x, y, textOptions);
			pageModifier.endContext().writePage();
			var infoDictionary = pdfWriter.getDocumentContext().getInfoDictionary();
			infoDictionary.creator = 'BlockSig_'+docRequest.token;
			infoDictionary.addAdditionalInfoEntry('BlockSigData', JSON.stringify({
				token: docRequest.token,
				ethvigil_api_prefix: ethvigil_api[network].prefix,
				sender: docRequest.sender,
				signers: docRequest.signers
			}));
			pdfWriter.end();
			writer = writer.toBuffer()
			const finalHash = sha3.keccak256(writer);
			/*
			//store the file on S3
			var params = {
				Bucket: config.get('s3').bucket,
				Key: 'bsfiles/'+docRequest.token+'_signed.pdf',
				Body: writer
			};
			var s3Response = await s3.putObject(params).promise();
			*/
			await writeFile(os.tmpdir()+'/'+docRequest.token+'_signed.pdf', writer);
			try {
				await spaceClient.addItems({
				targetPath: '/',
				sourcePaths: [os.tmpdir()+'/'+docRequest.token+'_signed.pdf']
			});
			}
			catch (e){
				console.error(e);
				ctx.body.error = 'space';
				ctx.status = 400;
				break;
			}
			var response = await request.post({
				url: ethvigil_api[network].prefix+'/finalizeDoc',
				headers: {'x-api-key': ethvigil_api[network].key},
				body: {
					originalHash: '0x'+docRequest.orig_hash,
					finalHash: '0x'+finalHash
				},
				json: true
			});
			if (!response.success){
				logError('ethvigil', response);
				ctx.body.error = 'ethvigil';
				ctx.status = 400;
				break;
			}
		break;
		//case 'Notarized':
		case 'Completed':
			const [completedDoc] = await mysqlPool.query('UPDATE docs SET ? WHERE id = ?', [{
				final_hash: ctx.request.body.event_data.finalHash.substr(2)
			}, docRequest.id]);
			console.log('doc completed', docRequest.token, ctx.request.body.event_data.finalHash);
			/*
			var params = {
				Bucket: config.get('s3').bucket,
				Key: 'bsfiles/'+docRequest.token+'_signed.pdf'
			};
			var s3Response = await s3.getObject(params).promise();
			*/
			const finalDoc = await spaceClient.openFile({
				path: docRequest.token+'_signed.pdf',
			});
			var _html = await readFile(__dirname+'/emails/completed_signers.html');
			_html = _html.toString().replace('__verifyUrl__', config.get('frontend_prefix')+'/verify.html');
			var mailOptions = {
				from: config.get('ses').from,
				to: docRequest.sender.email,
				subject: (config.get('dev') ? 'DEV - ' : '')+'[BlockSig'+mailPrefix+'] Document Ready - '+docRequest.name,
				text: 'All parties have signed the document (attached). Visit the following URL to verify proof on blockchain: '+config.get('frontend_prefix')+'/verify.html',
				html: _html.replace('__name__', docRequest.sender.name),
				attachments: [
					{
						filename: docRequest.name.replace('.', '')+'_signed.pdf',
						content: await readFile(finalDoc.getLocation())
						//content: new Buffer(s3Response.Body)
					}
				]
			};
			transporter.sendMail(mailOptions, (error, info) => {
				if (error){
					logError('email', error);
				} else {
					console.log(info);
				}
			});
			for (i in docRequest.signers){
				if (docRequest.signers[i].email == docRequest.sender.email) {
					continue;
				}
				mailOptions.to = docRequest.signers[i].email;
				mailOptions.html = _html.replace('__name__', docRequest.signers[i].name)
				transporter.sendMail(mailOptions, (error, info) => {
					if (error){
						logError('email', error);
					} else {
						console.log(info);
					}
				});
			}
		break;
		default:
			logError('unknown event', ctx.request.body.event_name);
		break;
	}

	ctx.body = {
		success: true,
		event_name: ctx.params.eventName
	}
});

if (config.get('proxy')){
	app.use((ctx, next )=> {
		if (config.get('cloudflare') && ctx.header['cf-connecting-ip']){
			//This can still be spoofed if the load balancer IPs are known
			//Make sure to firewall this to Cloudflare IPs or setup authenticated origin pulls
			ctx.request.ip = ctx.header['cf-connecting-ip'];
		} else {
			if (ctx.header['x-forwarded-for']){
				ctx.request.ip = ctx.header['x-forwarded-for'].split(',');
				ctx.request.ip = ctx.request.ip[ctx.ip.length-1].trim();
			}
		}
		return next();
	})
}

const getSigRequest = async (ctx, token) => {
	var [sigRequest] = await mysqlPool.execute('SELECT sr.*, d.name as docName, d.url, d.orig_hash, d.token as doc_token, d.sender, d.plan, d.signatures, d.signers, d.notarize FROM requests as sr, docs as d WHERE sr.token = ? AND d.id=sr.doc_id', [token]);
	if (sigRequest.length == 0){
		logError('Unknown Sigrequest', token);
		ctx.body.error = 'notfound';
		ctx.status = 404;
		return;
	}
	sigRequest = sigRequest[0];
	if (sigRequest.status != 'pending'){
		logError('Sigrequest not pending', token);
		ctx.body.error = sigRequest.status;
		ctx.status = 403;
		return;
	}
	return sigRequest;
}


const ignoreHealthCheck = (mw) => {
	return async (ctx, next) => {
		if (ctx.url == apiPrefix+'/' || ctx.url == apiPrefix){
			await next();
		} else {
			await mw.call(this, ctx, next);
		}
	}
}

const logError = (label, error) => {
	console.error(label, error);
	sendToSlack('error', error, label)
}

const sendToSlack = (type, message, errorLabel) => {
	var hook;
	switch (type){
		case 'data':
			hook = slackDataHook;
		break;
		case 'stripe':
			hook = slackStripeHook;
		break;
		case 'error':
		default:
			message = (errorLabel ? errorLabel+"\n" : "")+"```"+message+"```";
			hook = slackErrorHook;
		break;
	}
	hook.send(message, function(err, res) {
		if (err) {
			console.error('Slack Error:', err);
		}
	});
}

app.use(ignoreHealthCheck(logger()));
app.use(cors()).use(koaBody({multipart:true})).use(router.routes()).use(router.allowedMethods());

//for direct runs
if (!module.parent) {
	app.listen(config.get('port'));
	console.log(apiPrefix + ' listening on', config.get('port'));
}
