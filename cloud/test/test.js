/**
 * Created by lzw on 14-8-16.
 */
var should = require('should');
var express = require('express')
  , Route = express.Route
  , assert = require('assert');
var request = require('supertest');
var winston = require('winston');
var jsdom = require("jsdom");
var jquery = require('jquery');

function log(s) {
  console.log(s);
}

describe('Route', function () {
  var url = 'http://localhost:3000';
  before(function (done) {
    done();
  });

  describe('Create Ticket And Delete', function () {
    this.timeout(4000);

    function randomId(){
      return Math.random().toString(36).substring(7);
    }

    var title='测试'+randomId();

    it('should create ticket', function (done) {

      var params = {
        title: title,
        type: 'ios',
        content: '测试',
        app: -1,
        email: 'lzwjava@gmail.com'
      };


      request(url)
        .post('/tickets')
        .send(params)
        // end handles the response
        .end(function (err, res) {
          if (err) {
            throw err;
          }
          res.status.should.equal(302);
          res.redirect.should.equal(true);
          done();
        });
    });

    it.skip('login in as administrator', function (done) {
      jsdom.env({
        url: url+'/tickets',
        src: [jquery],
        done: function (errors, window) {
          if(errors){
            log(errors);
          }else{
            var $ = window.$;
            log($);
          }
          //log($("div#col-md-12").text());
          done();
        }
      });
    });

    it.skip('login in as administrator', function (done) {
      request(url)
        .get('/loginWithToken?token=645iecc912e1zlmf03x0t4ssxkfvy8ng')
        .send()
        .end(function (err, res) {
          if (err) {
            throw err;
          }
          jsdom.env(
            res.text,
            ["http://code.jquery.com/jquery.js"],
            function (errors, window) {
              //log("contents of a.the-link:", window.$("a").text());
            }
          );
          log(res);
          done();
        });
    });


    it.skip('should ', function (done) {
      var body = {
        firstName: 'JP',
        lastName: 'Berd'
      };
      request(url)
        .put('/tickets')
        .send(body)
        .expect('Content-Type', /json/)
        .expect(200) //Status code
        .end(function (err, res) {
          if (err) {
            throw err;
          }
          // Should.js fluent syntax applied
          res.body.should.have.property('_id');
          res.body.firstName.should.equal('JP');
          res.body.lastName.should.equal('Berd');
          res.body.creationDate.should.not.equal(null);
          done();
        });
    });
  });
});