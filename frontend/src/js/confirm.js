var doc, docToken, signaturePad, docHash, signatures, sigCount;
var signing = false;
var curPage = 1;

$(document).ready(function(){
	$('.sidenav').sidenav();
	$('.modal').modal();
	docToken = window.location.search.substr(1);
	var loadingTask;
	if (!docToken){
		showAlert("The link you followed was broken. Check again or email us at hello@blocksig.app");
		return;
	} else {
		$.getJSON(apiPrefix+'/view/'+docToken, function(d){
			$("#loader").hide();
			if (!d.success){
				console.error(d.error);
				showAlert("We had trouble getting data. Check again or email us at hello@blocksig.app");
				return;
			}
			$(".header span").text(d.data.name);
			var signerCount = Object.keys(d.data.signers).length;
			$("#loader p").html('Confirming document..');
			$("#loader").show();
			$.post(apiPrefix+'/confirm', { token: docToken }, "json").done(function(d){
				$("#close").show();
				console.log(signerCount);
				var text;
				if (signerCount == 0){
					text = "We've submitted your document to the blockchain. Once it propagates, we will email you the blockchain proof.";
				} else {
					text = "We've submitted your document to the blockchain. Once it propagates, we will request the signer"+(signerCount > 1 ? "s": "")+" for their signature"+(signerCount > 1 ? "s": "")+".";
				}
				$("#loader").hide();
				showAlert(text, "Success!");
			}).fail(function(d){
				$("#loader").hide();
				$("#close").show();
				showAlert("This document appears to have already been confirmed. Contact us at hello@blocksig.app");
			});
		});
	}
});
