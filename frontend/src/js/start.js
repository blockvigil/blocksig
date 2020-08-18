var fileReader = new FileReader();
var curPage = 1;
var doc, signaturePad, docHash, docName, sender, signatures, signers, stripeHandler, stripeTokenExists, paymentRequest;
var recaptchaToken = "";

var onloadCallback = function() {
    if (recaptchaKey){
        grecaptcha.render('recaptcha', {
            'sitekey' : recaptchaKey
        });
    }
};

$(document).ready(function(){
    console.log('loaded page..');
    $(".container").css('width', $(".container").width()*1.1);
    $('.sidenav').sidenav();
    $('.stepper').activateStepper({
        autoFocusInput: true
    });
    resizeStepper();
    $('.modal').modal();
    $('#mainform')[0].reset();
    $('#doc').on('change', function(){
    	if ($('#doc').prop('files').length > 0){
    		//console.log($('#doc').prop('files')[0]);
            //supporting 5MB for now
            if ($('#doc').prop('files')[0].size > 5242880){
                showAlert("Sorry, the file size is too big. Try something smaller than 5MB.");
                return;
            }
            var name = $('#doc').prop('files')[0].name;
            $('.stepper').activateFeedback();
    		fileReader.readAsBinaryString($('#doc').prop('files')[0]);
    		fileReader.onload = function () {
    			var data = fileReader.result;
    			var loadingTask = pdfjsLib.getDocument({data: data});
    			loadingTask.promise.then(function(pdf) {
    				//console.log('PDF loaded');
    				doc = pdf;
                    docHash = doc.fingerprint;
                    if (localStorage.getItem(docHash+'_name')){
                        docName = localStorage.getItem(docHash+'_name');
                    } else {
                        docName = $('#doc').prop('files')[0].name;
                        //localStorage.setItem(docHash+'_name', docName);
                    }
                    $("input[name=docName]").val(docName);
                    setPagination();
    				$(".navigation").show();
                    if (localStorage.getItem(docHash+'_signers')){
    					signers = JSON.parse(localStorage.getItem(docHash+'_signers'));
                        if (Object.keys(signers).length > 0){
                            $("#signers tbody").html('');
                            for (i in signers){
                                addSigner(i, signers[i].name, signers[i].email);
                            }
                        }
                    } else {
                        signers = {};
                    }
                    if (localStorage.getItem(docHash+'_sender')){
                        sender = JSON.parse(localStorage.getItem(docHash+'_sender'));
                        $("input[name=senderName]").val(sender.name);
                        $("input[name=senderEmail]").val(sender.email);
                    }
    				$(".signatures").html('');
    				if (localStorage.getItem(docHash+'_signatures')){
    					signatures = JSON.parse(localStorage.getItem(docHash+'_signatures'));
                        if (Array.isArray(signatures)){
                            signatures = {};
                            localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
                        } else {
                            var sigCount = Object.keys(signatures).length;
                            for (i in signatures){
                                var options = '<option value="0"'+(signatures[i].signer == 0 ? ' selected': '')+'>'+($("#notarize").prop('checked') ? 'Notary' : 'You')+' ('+sender.name+')</option>';
                                for (j in signers){
                                    options += '<option value="'+j+'"'+(signatures[i].signer == j ? ' selected': '')+'>'+signers[j].name+'</option>';
                                }
                                $(".signatures").append('<div id="sig'+i+'" class="signdiv z-depth-3 blue lighten-2" style="top: '+signatures[i].position.top+'px; left: '+signatures[i].position.left+'px;"><span class="xsign" onclick="removeSign('+i+')"><i class="material-icons left">clear</i></span><span class="text">Signature Block '+i+'</span><div class="input-field"><select><option>Choose Signer</option>'+options+'</select≥<span class="xsign"><i class="material-icons left">clear</i>Remove</span></div>');
                                $("#sig"+i).draggable({
                                    stop: function(event, ui){
                                        signatures[parseInt($(this).attr('id').substr(3))].position = ui.position;
                                        localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
                                    },
                                    scroll: true,
                                    containment: "#the-canvas"
                                });
                            }
                            if (sigCount > 0){
                                $('select').formSelect();
                                $('select').off().on('change', function(){
                                    var sigid = parseInt($(this).closest('div').parent().parent().attr('id').substr(3));
                                    var val = parseInt($(this).val());
                                    if (signatures[sigid].signer){
                                        delete signers[signatures[sigid].signer].blocks[sigid];
                                    }
                                    signatures[sigid].signer = val;
                                    if (val > 0){
                                        signers[val].blocks[sigid] = true;
                                    }
                                    localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
                                    localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
                                });
                                $(".remove .count").text(sigCount);
                                $(".remove").show();
                            }
                        }
    				} else {
                        signatures = {};
                    }
                    M.updateTextFields();
                    // Fetch the first page
    				renderPage(doc, 1);
                    //$('.stepper').nextStep();
                    $('.stepper').destroyFeedback();
    			}, function(error){
    				console.log(error.message);
    				showAlert("Try a different PDF file?");
                    $('.stepper').destroyFeedback();
    			});
    		}
    	}
    });

    stripeHandler = StripeCheckout.configure({
        key: stripeKey,
        image: 'https://blocksig.app/logos/blocksig_square.png',
        locale: 'auto',
        token: function(token) {
            console.log(token);
            stripeTokenExists = true;
            submit(token.id);
        },
        closed: function(){
            if (!stripeTokenExists){
                $('.stepper').destroyFeedback();
            }
        }
    });
    var stripe = Stripe(stripeKey);
    paymentRequest = stripe.paymentRequest({
        country: 'US',
        currency: 'usd',
        total: {
            label: 'BlockSig Monthly Plan',
            amount: 500,
        },
        requestPayerName: true,
        requestPayerEmail: true,
    });
    var elements = stripe.elements();
    var prButton = elements.create('paymentRequestButton', {
        paymentRequest: paymentRequest,
    });
    // Check the availability of the Payment Request API first.
    paymentRequest.canMakePayment().then(function(result) {
        if (result) {
            prButton.mount('#payment-request-button');
        } else {
            $('#payment-request-button').remove();
        }
    });
    paymentRequest.on('token', function(ev) {
        console.log(ev.token);
        ev.complete('success');
        submit(ev.token.id);
    });
});

function check(){
    if (!doc){
        $('.stepper').destroyFeedback();
        showAlert('You need to add a document')
        return false;
    }
    sender = {
        name: $("input[name=senderName]").val().trim(),
        email: $("input[name=senderEmail]").val().trim()
    };
    docName = $("input[name=docName]").val().trim();
    localStorage.setItem(docHash+'_sender', JSON.stringify(sender));
    localStorage.setItem(docHash+'_name', docName);
    $('.stepper').nextStep();
    return true;
}

function signerCheck(){
    var flag = true;
    $("#signers tbody tr").each(function(){
        var $this = $(this);
        var id = $this.data('id');
        var name = $this.find('input[name=name'+id+']').val().trim();
        var email = $this.find('input[name=email'+id+']').val().trim();
        if (name){
            if (email){
                if (signers[id]){
                    signers[id].name = name;
                    signers[id].email = email;
                } else {
                    signers[id] = {
                        name: name,
                        email: email,
                        blocks: {}
                    };
                }
            } else {
                showAlert('You need to add an email for '+name);
                flag = false;
            }
        } else {
            if (email){
                showAlert('You need to add a name for '+email);
                flag = false;
            }
        }
    });
    localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
    if (flag){
        $(".signatures").html('');
        for (i in signatures){
            var options = '<option value="0"'+(signatures[i].signer == 0 ? ' selected': '')+'>'+($("#notarize").prop('checked') ? 'Notary' : 'You')+' ('+sender.name+')</option>';
            for (j in signers){
                options += '<option value="'+j+'"'+(signatures[i].signer == j ? ' selected': '')+'>'+signers[j].name+'</option>';
            }
            $(".signatures").append('<div id="sig'+i+'" class="signdiv z-depth-3 blue lighten-2" style="top: '+signatures[i].position.top+'px; left: '+signatures[i].position.left+'px;"><span class="xsign" onclick="removeSign('+i+')"><i class="material-icons left">clear</i></span><span class="text">Signature Block '+i+'</span><div class="input-field"><select><option>Choose Signer</option>'+options+'</select≥<span class="xsign"><i class="material-icons left">clear</i>Remove</span></div>');
            $("#sig"+i).draggable({
                stop: function(event, ui){
                    signatures[parseInt($(this).attr('id').substr(3))].position = ui.position;
                    localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
                },
                scroll: true,
                containment: "#the-canvas"
            });
        }
        if (Object.keys(signatures).length > 0){
            $('select').formSelect();
            $('select').off().on('change', function(){
                var sigid = parseInt($(this).closest('div').parent().parent().attr('id').substr(3));
                var val = parseInt($(this).val());
                if (signatures[sigid].signer){
                    delete signers[signatures[sigid].signer].blocks[sigid];
                }
                signatures[sigid].signer = val;
                if (val > 0){
                    signers[val].blocks[sigid] = true;
                }
                localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
                localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
            });
        }
        $('.stepper').nextStep();
        $("#docstep").css('max-width',$(".container").width());
        resizeStepper();
    } else {
        $('.stepper').destroyFeedback();
    }
    return flag;
}

function finalCheck(){
    var p = "";
    var sigCount = 0;
    for (i in signatures){
        if (isNaN(signatures[i].signer)){
            showAlert('You have not chosen all signer(s)!');
            $('.stepper').destroyFeedback();
            return false;
        }
        if (!p && signatures[i].signer == 0){
            p = "<br/>1. "+($("#notarize").prop('checked') ? "Notary (You)" : "You");
            sigCount = 1;
        }
    }
    if (sigCount == 0 && $("#notarize").prop('checked')){
        showAlert('You have not chosen a block for your notary signature!');
        $('.stepper').destroyFeedback();
        return false;
    }
    for (i in signers){
        if (Object.keys(signers[i].blocks).length == 0){
            showAlert('You have not added a signature block for '+signers[i].name+'!');
            $('.stepper').destroyFeedback();
            return false;
        }
    }
    $(".review .info .name").text(sender.name);
    $(".review .info .email").text(sender.email);
    $(".review .document .name").text(docName+' ('+doc.numPages+' Page'+(doc.numPages == 1 ? '' : 's')+')');
    for (i in signers){
        sigCount++;
        p += "<br/>"+sigCount+". "+signers[i].name+" | "+signers[i].email;
    }
    if (!p){
        p = "None";
    }
    $(".review .signers p").html(p);
    $(".review .document .blockcount").text(Object.keys(signatures).length+ ' Signature'+(Object.keys(signatures).length == 1 ? '' : 's'));
    $('.stepper').nextStep();
    resizeStepper();
    $('.tabs').tabs({
        'onShow': function(){
            setTimeout(function(){
                switch ($("#plans div.active").attr('id')){
                    case 'free':
                        $('#payment-request-button').hide();
                        $("#recaptcha").show();
                    break;
                    case 'monthly':
                        $("#recaptcha").hide();
                        $('#payment-request-button').show();
                        paymentRequest.update({
                            total: {
                                label: 'BlockSig Monthly Plan',
                                amount: 500,
                            }
                        });
                    break;
                    case 'paygo':
                        $("#recaptcha").hide();
                        $('#payment-request-button').show();
                        paymentRequest.update({
                            total: {
                                label: 'BlockSig Pay as you Go',
                                amount: 100,
                            }
                        });
                    break;
                }
            }, 300);
        }
    });
    return true;
}

function submit(stripeToken){
    if (!stripeToken && $("#plans div.active").attr('id') != 'free'){
        stripeTokenExists = false;
        var options = {
            name: 'BlockSig',
            zipCode: true
        }
        switch ($("#plans div.active").attr('id')){
            case 'monthly':
                options.description = 'Monthly Plan';
                options.amount = 500;
            break;
            case 'paygo':
                options.description = 'Pay As You Go';
                options.amount = 100;
            break;
        }
        stripeHandler.open(options);
        return false;
    }
    if (!stripeToken && recaptchaKey && !recaptchaToken){
        if (typeof(grecaptcha) == "undefined"){
            showAlert("We could not load Google Recaptcha! Your browser may have some tracking protection that may be preventing it.");
            return false;
        }
        grecaptcha.reset();
        showAlert("You need to solve the captcha!");
        $('.stepper').destroyFeedback();
        return false;
    }
    var data = {
        recaptchaToken: recaptchaToken,
        stripeToken: stripeToken,
        plan: $("#plans div.active").attr('id'),
        docHash: docHash,
        docName: docName,
        sender: sender,
        signatures: signatures,
        notarize: $("#notarize").prop('checked'),
        signers: {}
    };
    for (i in signers){
        data.signers[i] = {
            name: signers[i].name,
            email: signers[i].email
        };
    }
    for (i in signatures){
        if (signatures[i].signer == 0){
            data.signers[0] = sender;
            break;
        }
    }
    data = JSON.stringify(data);
    console.log(data);
    var formData = new FormData();
    formData.append('document', $('#doc').prop('files')[0]);
    formData.append('json', data);
    $.ajax({
        type: "POST",
        url: apiPrefix+'/submit',
        data: formData,
        success: function(d){
            console.log(d)
            //showAlert("Please check your email and follow the link!", "Success");
            $('.stepper').nextStep();
            recaptchaToken = "";
            localStorage.removeItem(docHash+'_signatures');
            localStorage.removeItem(docHash+'_signers');
        },
        error: function(d){
            console.log(d);
            if (d.responseJSON && d.responseJSON.error == 'recaptcha'){
                grecaptcha.reset();
                recaptchaToken = "";
                showAlert("Please solve the captcha again!");
            } else if (d.responseJSON && d.responseJSON.error == 'stripe'){
                showAlert("Stripe could not charge your card. Please try another one!");
            } else {
                showAlert("Something went wrong!");
            }
            $('.stepper').destroyFeedback();
        },
        contentType: false,
        processData: false,
        dataType: "json"
    });
    return true;
}

function addSigner(id, name, email){
    var signersDiv = $("#signers");
    id = id ? id : (signersDiv.find('tbody tr:last').data('id') ? signersDiv.find('tbody tr:last').data('id')+1: 1);
    name = name ? name : '';
    email = email ? email : '';
    signersDiv.append('<tr data-id="'+id+'">\
        <td>\
            <div class="input-field col s12">\
                <input name="name'+id+'" value="'+name+'" class="validate" type="text">\
            </div>\
        </td>\
        <td>\
            <div class="input-field col s12">\
                <input name="email'+id+'" value="'+email+'" class="validate" type="email">\
            </div>\
        </td>\
        <td>\
            <div class="input-field col s12">\
                <a onclick="removeSigner('+id+')" style="cursor: pointer;"><i class="material-icons left">clear</i></a>\
            </div>\
        </td>\
    </tr>');
}

function removeSigner(id){
    if (signers[id] == undefined){
        $("#signers tr[data-id="+id+"]").remove();
        return;
    }
    var blockCount = Object.keys(signers[id].blocks).length;
    if (blockCount > 0){
        showAlert('You have assigned '+signers[id].name+' in '+blockCount+' signature block(s), remove/change them first!');
        return false;
    }
    delete signers[id];
    $("#signers tr[data-id="+id+"]").remove();
    localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
}

function addSign(){
    var signaturesDiv = $(".signatures");
    var sigid = signaturesDiv.find('.signdiv:last').attr('id') ? parseInt(signaturesDiv.find('.signdiv:last').attr('id').substr(3))+1 : 1;
    signatures[sigid] = {page: curPage, position: {top: 0, left: 0}};
    localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
    var options = '';
    for (i in signers){
        options += '<option value="'+i+'">'+signers[i].name+'</option>';
    }
	$(".signatures").append('<div id="sig'+sigid+'" class="signdiv z-depth-3 blue lighten-2"><span class="xsign" onclick="removeSign('+sigid+')"><i class="material-icons left">clear</i></span><span class="text">Signature Block '+sigid+'</span><div class="input-field"><select><option>Choose Signer</option><option value="0">'+($("#notarize").prop('checked') ? 'Notary' : 'Your')+' ('+sender.name+')</option>'+options+'</select≥</div>');
    $("#sig"+sigid).draggable({
        stop: function(event, ui){
            signatures[parseInt($(this).attr('id').substr(3))].position = ui.position;
            localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
        },
        scroll: true,
        containment: "#the-canvas"
    });
    $('#sig'+sigid+' select').formSelect();
    $('#sig'+sigid+' select').off().on('change', function(){
        var sigid = parseInt($(this).closest('div').parent().parent().attr('id').substr(3));
        var val = parseInt($(this).val());
        if (signatures[sigid].signer){
            delete signers[signatures[sigid].signer].blocks[sigid];
        }
        signatures[sigid].signer = val;
        if (val > 0){
            signers[val].blocks[sigid] = true;
        }
        localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
        localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
    });
    $(".remove").show();
    $(".remove .count").text(Object.keys(signatures).length);
}

function removeSigns(flag){
    if (!confirm("This will delete signature blocks from all page(s). Are you sure?")){
        return;
    }
	signatures = {};
	$(".signatures").html('');
    $(".remove").hide();
	localStorage.removeItem(docHash+'_signatures');
    for (i in signers){
        signers[i].blocks = {};
    }
    localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
}

function removeSign(id){
    if (!confirm('Remove block?')){
        return false;
    }
    delete signatures[id];
    for (i in signers){
        if (signers[i].blocks[id]){
            delete signers[i].blocks[id];
        }
    }
    $("#sig"+id).remove();
    localStorage.setItem(docHash+'_signatures', JSON.stringify(signatures));
    localStorage.setItem(docHash+'_signers', JSON.stringify(signers));
    var sigCount = Object.keys(signatures).length;
    if (Object.keys(signatures).length == 0){
        $(".remove").hide();
    } else {
        $(".remove .count").text(sigCount);
    }
}

function setCaptcha(token){
    recaptchaToken = token;
}

function resizeStepper() {
    newHeight = 0;
    padding = 300;
    var step = $('#stepper').find('.step.active');
    var max = step.find('.step-content').css('max-height');
    if (max == "none"){
        $('#stepper').find('.step.active').find('.step-content > div').each(function()
        {
            newHeight += parseInt($(this).css('height'));
        });
        newHeight += padding;
    } else {
        newHeight += parseInt(max);
    }
    $('#stepper').css('height', newHeight);
}
