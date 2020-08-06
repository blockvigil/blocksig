/* Common functions */

function showAlert(message, title){
	$("#alert p").text(message);
	if (!title){
		title = 'Error!';
	}
	$("#alert h4").text(title);
	$('#alert').modal("open");
}

function setPagination(){
	$(".pagination.top").html('<li class="waves-effect disabled"><a onclick="prevPage()"><i class="material-icons">chevron_left</i></a></li><li class="waves-effect active"><a onclick="renderPage(doc, 1)">1</a></li><li class="waves-effect disabled"><a onclick="nextPage()"><i class="material-icons">chevron_right</i></a></li>');
	if (doc.numPages > 1){
		var last = $(".pagination.top li").last();
		for (i=2; i<=doc.numPages; i++){
			last.before('<li class="waves-effect"><a onclick="renderPage(doc, '+i+')">'+i+'</a></li>');
		}
		last.removeClass('disabled');
	}
	$(".pagination.bottom").html($(".pagination.top").html());
}

function prevPage(){
	if (curPage == 1){
		showAlert('On the first page!');
		return;
	}
	renderPage(doc, curPage-1);
}
function nextPage(){
	if (curPage == doc.numPages){
		showAlert('On the last page!');
		return;
	}
	renderPage(doc, curPage+1);
}

function renderPage(pdf, pageNumber){
	if (pageNumber < 1 || pageNumber > pdf.numPages){
		alert("Enter between 1 and "+pdf.numPages);
		return;
	}
	if (curPage != pageNumber){
		$(".pagination.top .active").removeClass('active');
		$(".pagination.top li:nth-child("+(pageNumber+1)+")").addClass('active');
	}
	if (curPage == 1){
		$(".pagination.top li").first().addClass('disabled');
		if (doc.numPages > 1){
			$(".pagination.top li").last().removeClass('disabled');
		}
	}
	if (curPage == doc.numPages){
		$(".pagination.top li").last().addClass('disabled');
		if (doc.numPages > 1){
			$(".pagination.top li").first().removeClass('disabled');
		}
	}
	$(".pagination.bottom").html($(".pagination.top").html());
	curPage = pageNumber;
	$("#pageinfo").text(pageNumber+'/'+pdf.numPages);
	pdf.getPage(pageNumber).then(function(page) {
		var scale = 1.5;
		var viewport = page.getViewport(scale);

		// Prepare canvas using PDF page dimensions
		var canvas = document.getElementById('the-canvas');
		var context = canvas.getContext('2d');
		canvas.height = viewport.height;
		canvas.width = viewport.width;

		// Render PDF page into canvas context
		var renderContext = {
			canvasContext: context,
			viewport: viewport
		};
		var renderTask = page.render(renderContext);
		$("#the-canvas").show();
		renderTask.then(function () {
			$("#doc").css('max-width',$(".container").width());
			$(".signdiv").each(function(){
				var $this = $(this);
				if (signatures[parseInt($this.attr('id').substr(3))].page == curPage){
					$this.show();
				} else {
					$this.hide();
				}
			});
		});
	});
}
