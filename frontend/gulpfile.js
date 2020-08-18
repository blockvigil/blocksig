require('dotenv').config();
var autoprefixer = require('gulp-autoprefixer');
var csso = require('gulp-csso');
var del = require('del');
var gulp = require('gulp');
var htmlmin = require('gulp-htmlmin');
var runSequence = require('run-sequence');
var uglify = require('gulp-uglify');
var headerfooter = require('gulp-headerfooter');
var cachebust = require('gulp-cache-bust');
var watch = require('gulp-watch');
var template = require('gulp-template');
var inject = require('gulp-inject');
var glob = require("glob");
var path = require('path');
var awspublish = require('gulp-awspublish');

const htmlTargets = glob.sync("./src/html/*.html");

gulp.task('watch', function () {
	// Callback mode, useful if any plugin in the pipeline depends on the `end`/`flush` event
	return watch('./src/**/*', gulp.series('default'));
});

// Gulp task to minify CSS files
gulp.task('styles', function () {
	return gulp.src('./src/css/**/*.css')
		// Auto-prefix css styles for cross browser compatibility
		.pipe(autoprefixer())
		// Minify the file
		.pipe(csso())
		// Output
		.pipe(gulp.dest('./dist/css'))
});

// Gulp task to minify JavaScript files
gulp.task('scripts', function() {
	return gulp.src('./src/js/**/*.js')
		// Minify the file
		.pipe(uglify())
		// Output
		.pipe(gulp.dest('./dist/js'))
});

// Gulp task to copy libs not being served from CDN
gulp.task('libs', function() {
	return gulp.src('./src/lib/*')
		.pipe(gulp.dest('./dist/lib'))
});

// Gulp task to merge header/footer & minify HTML files
gulp.task('pages', async function() {
	if (!process.env.API_PREFIX){
		throw 'API_PREFIX is missing';
	}
	for (let i=0; i<htmlTargets.length; i++){
		let htmlTarget = htmlTargets[i];
		let fileName = htmlTarget.split('/')[3].split('.')[0];
		//const cssCources = gulp.src(['./src/css/'+fileName+'.css', (fileName == 'start' ? './src/css/materialize-stepper.min.css' : '')], {read: false});
		const cssCources = gulp.src((fileName == 'start' ? ['./src/css/materialize-stepper.min.css', './src/css/'+fileName+'.css'] : './src/css/'+fileName+'.css'), {read: false, allowEmpty: true});
		const jsSources = gulp.src(['./src/js/'+fileName+'.js'], {read: false});
		await new Promise(function(resolve, reject) {
			gulp.src(htmlTarget)
			.pipe(headerfooter.header('./src/header.html'))
			.pipe(template({
				fileName: fileName,
				stripeKey: process.env.STRIPE_KEY,
				recaptchaKey: process.env.RECAPTCHAKEY,
				apiPrefix: process.env.API_PREFIX,
				contractAddress: process.env.CONTRACT_ADDRESS,
				ethvigil_apiPrefix: process.env.ETHVIGIL_API_PREFIX
			}))
			.pipe(inject(cssCources, {ignorePath: 'src', addRootSlash: false}))
			.pipe(headerfooter.footer('./src/footer.html'))
			.pipe(inject(jsSources, {ignorePath: 'src', addRootSlash: false}))
			.pipe(htmlmin({
				collapseWhitespace: true,
				removeComments: true
			}))
			.pipe(cachebust({
				type: 'timestamp'
			}))
			.pipe(gulp.dest('./dist'))
			.on('end', resolve)
		});
	}
});

// Gulp task to copy robots.txt file
gulp.task('robots', function () {
	//#FIXME make it conditional later
	return gulp.src('./src/robots.txt')
		.pipe(gulp.dest('./dist/'))
});

// Gulp task to copy applepay web association file
gulp.task('applepay', function () {
	//#FIXME make it conditional later
	return gulp.src('./src/.well-known/*')
		.pipe(gulp.dest('./dist/.well-known'))
});

// Gulp task to deploy to s3
gulp.task('deploy', function() {
	if (!process.env.S3_BUCKET || !process.env.S3_ACCESSKEYID || !process.env.S3_SECRETACCESSKEY){
		throw 'mandatory env values missing';
	}
	// create a new publisher using S3 options
	// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property
	var publisher = awspublish.create({
		region: '',
		params: {
			Bucket: process.env.S3_BUCKET
		},
		credentials: {
			accessKeyId: process.env.S3_ACCESSKEYID,
			secretAccessKey: process.env.S3_SECRETACCESSKEY,
		}
	});

	// define custom headers
	var headers = {
		'Cache-Control': 'max-age=315360000, no-transform, public'
		// ...
	};

	return gulp.src('./dist/**/*')
		 // gzip, Set Content-Encoding headers and add .gz extension
		//.pipe(awspublish.gzip({ ext: '.gz' }))

		// publisher will add Content-Length, Content-Type and headers specified above
		// If not specified it will set x-amz-acl to public-read by default
		.pipe(publisher.publish()) //skipping headers for Cloudflare testing

		//.pipe(publisher.sync())

		// create a cache file to speed up consecutive uploads
		//.pipe(publisher.cache())

		 // print upload updates to console
		.pipe(awspublish.reporter());
});

// Clean output directory
gulp.task('clean', () => del(['dist']));

// Gulp default task
gulp.task('default', gulp.series(
		'styles',
		'scripts',
		'libs',
		'robots',
		'applepay',
		'pages'
));
