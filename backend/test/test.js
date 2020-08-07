require('should');
process.env.TESTS = true;
const app = require('../');
const server = app.listen();
const request = require('supertest').agent(server);
const url = 'http://127.0.0.1:'+server.address().port;
const config = require('config');
const apiPrefix = config.get('api_prefix');

console.log('URL', url);

describe('Main', function() {
	describe('GET /', function() {
		it('should get a success on health check', function(done) {
			request
			.get(apiPrefix+'/')
			.expect('Content-Type', /json/)
			.expect(200, function(err, res) {
				if (err) return done(err);
				res.text.should.be.json;
				should(JSON.parse(res.text).success).be.exactly(true);
				done();
			});
		});
	});
	describe('GET /check', function() {
		it('should get a success and data as Hello World', function(done) {
			request
			.get(apiPrefix+'/check')
			.expect('Content-Type', /json/)
			.expect(200, function(err, res) {
				if (err) return done(err);
				res.text.should.be.json;
				should(JSON.parse(res.text).success).be.exactly(true);
                should(JSON.parse(res.text).data.message).be.exactly('Hello World');
				done();
			});
		});
	});
});

after(done => {
	server.close();
	done();
	process.exit(0);
});
