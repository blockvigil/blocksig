var doc, docToken, signaturePad, docHash, signatures, sigCount, signerCount;
var signing = false;
var curPage = 1;
var signBox;

$(document).ready(function(){
	$('.sidenav').sidenav();
	$('.modal').modal();
	docToken = window.location.search.substr(1);
	var canvas = document.getElementById('signbox');
	signBox = new SignaturePad(canvas);
	var loadingTask;
	if (!docToken){
		showAlert("The link you followed was broken. Check again or email us at hello@blocksig.app");
		return;
	} else {
		loadingTask = pdfjsLib.getDocument(apiPrefix+'/getDoc/'+docToken);
	}
	loadingTask.promise.then(function(pdf) {
		console.log('PDF loaded');
		doc = pdf;
		console.log(doc.numPages);
		$(".navigation").show();
		docHash = doc.fingerprint;
		console.log('docHash', docHash);
		console.log('Pages', doc.numPages);
		setPagination();
		$(".signatures").html('');
		$.getJSON(apiPrefix+'/getSignatures/'+docToken, function(d){
			$("#loader").hide();
			$("#loader p").text('');
			if (!d.success){
				console.error(d.error);
				showAlert("We had trouble getting data. Check again or email us at hello@blocksig.app");
				return;
			}
			signatures = d.data.signatures;
			signerCount = Object.keys(d.data.signers).length;
			sigCount = 0;
			for (i in signatures){
				var self = signatures[i].signer == d.data.signer_id ? true : false
				$(".signatures").append('<div id="sig'+i+'"'+
				(self ? ' onclick="showSignBox()"' : '')+' class="signdiv'+
				(self ? " self" : "")+'" style="top: '+signatures[i].position.top+'px; left: '+signatures[i].position.left+'px;">'+
				(self ? '<canvas id="csig'+i+'" class="signature" width="240" height="80"></canvas>' : '')+'<span class="center">'
				+(self ? "Your Signature" : d.data.signers[signatures[i].signer].name+"'s Signature")
				+'</span></div>');
				if (self){
					sigCount++;
				}
			}
			$(".btn.add span").text(sigCount);
			$("#index-banner").show();
			// Fetch the first page
			renderPage(doc, 1);
		});
		//signatures = JSON.parse(localStorage.getItem(docHash+'_signatures'));
	}, function(error){
		console.log(error.message);
		if (error.status == 403){
			showAlert("This document appears to have been signed/canceled. Contact the sender or email us at hello@blocksig.app");
		} else {
			showAlert("We had trouble loading the document. Contact the sender or email us at hello@blocksig.app");
		}
		$("#loader").hide();
	});
});

function clearSigns(){
	$(".signdiv.self").each(function(){
		var $this = $(this);
		if (signatures[parseInt($this.attr('id').substr(3))].pad){
			signatures[parseInt($this.attr('id').substr(3))].pad.clear();
		}
	});
	signBox.clear();
	$(".add").show();
	$(".clear").hide();
	$(".finish").hide();
	M.toast({html: "Cleared all signature(s)!"});
}

function toggleSign(){
	if (!signing){
		$(".signdiv.self span").hide();
		$(".signdiv.self").find("canvas").each(function(){
			var $this = $(this);
			if (signatures[parseInt($this.attr('id').substr(4))].pad){
				signatures[parseInt($this.attr('id').substr(4))].pad.on();
			} else {
				var canvas = document.getElementById($this.attr('id'));
				console.log(canvas);
				signatures[parseInt($this.attr('id').substr(4))].pad = new SignaturePad(canvas);
				$this.show();
			}
		});
		signing = true;
	} else {
		$(".signdiv.self").each(function(){
			var $this = $(this);
			signatures[parseInt($this.attr('id').substr(3))].pad.off();
		});
		$(".signdiv.self span").show();
		signing = false;
	}
}

function showSignBox(){
	$('#signmodal').modal("open");
}

function addSign(){
	var data = signBox.toData();
	$(".signdiv.self").find("canvas").each(function(){
		var $this = $(this);
		if (!signatures[parseInt($this.attr('id').substr(4))].pad){
			var canvas = document.getElementById($this.attr('id'));
			console.log(canvas);
			signatures[parseInt($this.attr('id').substr(4))].pad = new SignaturePad(canvas);
			signatures[parseInt($this.attr('id').substr(4))].pad.off();
			$this.show();
		}
		signatures[parseInt($this.attr('id').substr(4))].pad.fromData(data)
	});
	$('#signmodal').modal("close");
	if (signBox.isEmpty()){
		$(".signdiv.self span").show();
		$(".add").show();
		$(".clear").hide();
		$(".finish").hide();
	} else {
		M.toast({html: "Updated "+sigCount+" signature(s)!"});
		$(".signdiv.self span").hide();
		$(".add").hide();
		$(".clear").show();
		$(".finish").show();
	}
}

function finish(){
	$(".finish").hide();
	$("#loader").show();
	var data = {
		token: docToken,
		signatureData: signBox.toDataURL()
	}
	$.ajax({
		type: "POST",
		url: apiPrefix+'/sign',
		data: JSON.stringify(data),
		success: function(d){
			var text;
			if (signerCount == 1 || d.notarized){
				text = 'All done! We will soon email a finalized document along with proof on blockchain!';
			} else {
				text = 'You\'re all set! When the remaining signers add their signatures, we will email you a finalized document along with proof on blockchain!';
			}
			showAlert(text, 'Sucess!');
			$(".btn").hide();
			$(".signdiv.self").prop('onclick',null).off().on('click', function(){
				showAlert(text, 'Sucess!');
			});
			$("#loader").hide();
		},
		error: function(d){
			console.log(d);
			showAlert('Something went wrong!');
			$(".finish").show();
			$("#loader").hide();
		},
		contentType: "application/json",
		dataType: "json"
	});
}
