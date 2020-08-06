var fileReader = new FileReader();
var originalHash, finalHash, docToken;
var $form;
var eth, contract;
var contractABI = [{"constant":false,"inputs":[{"name":"hash","type":"bytes32"},{"name":"signers","type":"address[]"}],"name":"createDoc","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"hash","type":"bytes32"},{"name":"signer","type":"address"}],"name":"sign","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"hash","type":"bytes32"}],"name":"getFinalDoc","outputs":[{"name":"originalHash","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"hash","type":"bytes32"},{"name":"signer","type":"address"}],"name":"getSignerTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"originalHash","type":"bytes32"},{"name":"finalHash","type":"bytes32"}],"name":"finalizeDoc","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"hash","type":"bytes32"}],"name":"getDocument","outputs":[{"name":"createdTime","type":"uint256"},{"name":"remainingSignatures","type":"uint256"},{"name":"completedTime","type":"uint256"},{"name":"completedHash","type":"bytes32"},{"name":"status","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hash","type":"bytes32"}],"name":"Created","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hash","type":"bytes32"},{"indexed":false,"name":"signer","type":"address"}],"name":"Signature","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hash","type":"bytes32"}],"name":"Signed","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hash","type":"bytes32"},{"indexed":false,"name":"finalHash","type":"bytes32"}],"name":"Completed","type":"event"}];


$(document).ready(function(){
	$('.sidenav').sidenav();
	$('.modal').modal();
	pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
	$form = $('.box');
	$form.css('height', parseInt($("main").css('height'))-parseInt($(".container h3").css('height'))-60);
	$form.css('width', parseInt($(".container").css('width')));
	if (location.pathname.substr(0, 5) == '/ipfs'){
		$("#docInfo .ipfs").hide();
	} else {
		$("#docInfo .ipfs").off().on('click', function(){
			window.open('https://ipfs.io/ipfs/QmdMpi9k2sYynu8ZhqVt6YzWuL4NakQ638wDBQhTHry9wB/verify.html','_blank');
		});
	}
	if(isAdvancedUpload){
		$form
		.addClass( 'has-advanced-upload' ) // letting the CSS part to know drag&drop is supported by the browser
		.on( 'drag dragstart dragend dragover dragenter dragleave drop', function( e )
		{
			// preventing the unwanted behaviours
			e.preventDefault();
			e.stopPropagation();
		})
		.on( 'dragover dragenter', function() //
		{
			$form.addClass( 'is-dragover' );
		})
		.on( 'dragleave dragend drop', function()
		{
			$form.removeClass( 'is-dragover' );
		})
		.on( 'drop', function( e )
		{
			droppedFiles = e.originalEvent.dataTransfer.files; // the files that were dropped
			checkFile(droppedFiles);
		});
	}
	$('#doc').on('change', function(){
		checkFile(false);
	});
	// If web3 is not injected (modern browsers)...
	if (typeof web3 === 'undefined') {
		// Listen for provider injection
		window.addEventListener('message', function(data) {
			if (data && data.type && data.type === 'ETHEREUM_PROVIDER_SUCCESS') {
				// Use injected provider, start dapp...
				eth = new Eth(ethereum);
				console.log('got ethereum', data);
			}
		});
		// Request provider
		window.postMessage({ type: 'ETHEREUM_PROVIDER_REQUEST' }, '*');
	}
	// If web3 is injected (legacy browsers)...
	else {
		// Use injected provider, start dapp
		eth = new Eth(web3.currentProvider);
	}
});

function showUploader(){
	$(".box").show();
	$(".box__input").show();
	$("#docInfo").hide();
}

function checkFile(file){
	file = file ? file : $('#doc').prop('files');
	if (file.length > 0){
		var name = file[0].name;
		fileReader.readAsArrayBuffer(file[0]);
	} else {
		console.error('got no files yo');
		return;
	}
	fileReader.onload = function (){
		$("#loader").show();
		var data = fileReader.result;
		finalHash = keccak256(data);
		//using custom worker to parse the additional info object - FFS
		var loadingTask = pdfjsLib.getDocument({data: data});
		$(".box__input").hide();
		$("#docInfo").hide();
		loadingTask.promise.then(function(pdf) {
			pdf.getMetadata().then(function(data){
				$("#signers tbody").html('<tr><td colspan="2">This document had no signers.</td></tr>');
				console.log(data.info);
				if (data.info.BlockSigData){
					data = JSON.parse(data.info.BlockSigData);
					console.log('got blocksigdata', data);
					docToken = data.token;
				} else {
					console.log('missing blocksig data', data);
					var data = {
						ethvigil_api_prefix: ethvigil_apiPrefix,
						signers: {}
					}
				}
				data.ethvigil_paths = data.ethvigil_api_prefix.split('/');
				var prefix = "https://etherscan.io";
				var network = {
					id: 1,
					name: "Main"
				};
				switch (data.ethvigil_paths[2]){
					case "localhost:8080":
						prefix = "http://localhost:8282";
						network = {
							id: 8997,
							name: "Custom"
						}
					break;
					case "alpha-api.ethvigil.com":
						prefix = "https://kovan.etherscan.io";
						network = {
							id: 42,
							name: "Kovan"
						}
					break;
					case "beta-api.ethvigil.com":
						prefix = "https://goerli.etherscan.io";
						network = {
							id: 5,
							name: "Goerli"
						}
					break;
					case "mainnet-api.maticvigil.com":
					case "mainnet-api-in.maticvigil.com":
						prefix = "https://explorer.matic.network";
						network = {
							id: 137,
							name: "Matic Mainnet"
						}
					break;
					case "mainnet.ethvigil.com":
						prefix = "https://etherscan.io";
						network = {
							id: 1,
							name: "Mainnet"
						}
					break;
				}
				$("#docInfo .view").off().on('click', function(){
					window.open(prefix+'/address/'+data.ethvigil_paths[data.ethvigil_paths.length-1],'_blank');
				});
				if (eth){
					eth.net_version().then(function(d){
						if (d != network.id){
							//$(".box__input").show();
							//$("#loader").hide();
							showAlert("Please switch to "+network.name+" network in yout Metamask/Dapp browser for 100% proof. We will now use EthVigil API as a fallback for verification.", "Oops!");
							evFallback(data);
						} else {
							contract = eth.contract(contractABI).at(data.ethvigil_paths[data.ethvigil_paths.length-1]);
							contract.getFinalDoc('0x'+finalHash).then(function(d){
								originalHash = d.originalHash;
								if (originalHash == '0x'){
									$(".box__input").show();
									$("#loader").hide();
									showAlert("We had trouble checking the document proof on blockchain. Try again in a minute or email us at hello@blocksig.app");
									return;
								}
								contract.getDocument(originalHash).then(function(d){
									if (d.completedHash == '0x'){
										$(".box__input").show();
										$("#loader").hide();
										showAlert("We had trouble checking the document proof on blockchain. Email us at hello@blocksig.app");
										return;
									}
									addSigners(data.signers);
									addDocumentInfo(d);
								});
							});
						}
					});
				} else {
					evFallback(data);
				}
			});
		});
	}
}

function evFallback(data){
	$.getJSON(data.ethvigil_api_prefix+'/getFinalDoc/0x'+finalHash, function(d){
		//console.log(d);
		originalHash = d.data[0].originalHash;
		$.getJSON(data.ethvigil_api_prefix+'/getDocument/'+originalHash, function(d){
			if (d.success){
				addSigners(data.signers, data.ethvigil_api_prefix);
				addDocumentInfo(d.data[0]);
			}
		}).fail(function(d){
			$(".box__input").show();
			$("#loader").hide();
			showAlert("We had trouble checking the document proof on blockchain. Email us at hello@blocksig.app");
			console.log(d.responseJSON);
		});
	}).fail(function(d){
		$(".box__input").show();
		$("#loader").hide();
		showAlert("We had trouble checking the document proof on blockchain. Try again in a minute or email us at hello@blocksig.app");
		console.log(d.responseJSON);
	});
}

function addSigners(signers, prefix){
	if (Object.keys(signers).length > 0){
		$("#signers tbody").html('');
		for (i in signers){
			addSignerTime(signers[i], prefix);
		}
	}
}

function addSignerTime(signer, prefix){
	if (!prefix){
		contract.getSignerTime(originalHash, ethAccount.privateToAccount(keccak256(docToken+signer.email)).address.toLowerCase()).then(function(d){
			d[0] = timeDifference(d[0]*1000);
			var tr = "<tr><td>"+signer.name+" ("+signer.email+")</td><td>"+d[0]+"</td></tr>";
			$("#signers tbody").append(tr);
			$form.css('height', parseInt($("main").css('height'))-parseInt($(".container h3").css('height'))-60);
		})
		return;
	}
	$.getJSON(prefix+'/getSignerTime/'+originalHash+'/'+ethAccount.privateToAccount(keccak256(docToken+signer.email)).address.toLowerCase(), function(d){
		if (d.success){
			d = d.data[0];
			d['uint256'] = timeDifference(d['uint256']*1000);
			var tr = "<tr><td>"+signer.name+" ("+signer.email+")</td><td>"+d['uint256']+"</td></tr>";
			$("#signers tbody").append(tr);
			$form.css('height', parseInt($("main").css('height'))-parseInt($(".container h3").css('height'))-60);
		}
	});
}

function addDocumentInfo(data){
	var body = "";
	for (i in data){
		if (i == parseInt(i)){
			continue;
		}
		switch (i){
			case 'createdTime':
			case 'completedTime':
				data[i] = timeDifference(data[i]*1000);
			break;
			case 'status':
				switch (data[i]){
					case 'signed':
						data[i] = '<font color="green">signed</font>';
					break;
				}
			break
		}
		body += "<tr><td>"+i+"</td><td>"+data[i]+"</td></tr>";
	}
	$("#loader").hide();
	$("#info tbody").html(body);
	$("#docInfo").show();
	$(".box").hide();
}

function showAlert(message, title){
	$("#alert p").text(message);
	if (!title){
		title = 'Error!';
	}
	$("#alert h4").text(title);
	$('#alert').modal("open");
}

function timeDifference(previous, current) {
	current = current ? current : +new Date();
	var msPerMinute = 60 * 1000;
	var msPerHour = msPerMinute * 60;
	var msPerDay = msPerHour * 24;
	var msPerMonth = msPerDay * 30;
	var msPerYear = msPerDay * 365;
	var v;
	var elapsed = current - previous;

	if (elapsed < msPerMinute) {
		v = Math.round(elapsed/1000);
		return v + ' second'+(v>1 ? 's' : '')+' ago';
	}

	else if (elapsed < msPerHour) {
		v = Math.round(elapsed/msPerMinute);
		return v + ' minute'+(v>1 ? 's' : '')+' ago';
	}

	else if (elapsed < msPerDay ) {
		v = Math.round(elapsed/msPerHour);
		return v + ' hour'+(v>1 ? 's' : '')+' ago';
	}

	else if (elapsed < msPerMonth) {
		v = Math.round(elapsed/msPerDay);
		return v + ' day'+(v>1 ? 's' : '')+' ago';
	}

	else if (elapsed < msPerYear) {
		v = Math.round(elapsed/msPerMonth);
		return v + ' month'+(v>1 ? 's' : '')+' ago';
	}

	else {
		v = Math.round(elapsed/msPerYear);
		return v + ' year'+(v>1 ? 's' : '')+' ago';
	}
}

//https://css-tricks.com/drag-and-drop-file-uploading/
var isAdvancedUpload = function() {
  var div = document.createElement('div');
  return (('draggable' in div) || ('ondragstart' in div && 'ondrop' in div)) && 'FormData' in window && 'FileReader' in window;
}();
