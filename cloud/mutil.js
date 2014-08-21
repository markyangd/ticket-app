/**
 * Created by lzw on 14-8-8.
 */
var util = require('util');
var mlog=require('cloud/mlog.js');

function doErr(err){
  console.log(err);
}

function renderError(res, error) {
  if (error == null) {
    error = "Unknown error";
  }
  if (typeof error != 'string')
    error = util.inspect(error);
  res.render('500', {error: error});
}

function renderErrorFn(res) {
  return function (err) {
    renderError(res, err);
  };
}

function rejectFn(promise){
  return function(error){
    promise.reject(error);
  }
}

function logErrorFn(){
  return function(err){
    mlog.logError(err);
  }
}

function renderForbidden(res) {
  mlog.log('render forbidden');
  renderError(res, "Forbidden area.");
}

function renderInfo(res, info, backLink) {
  res.render('info', {info: info, backLink: backLink});
}

exports.doErr=doErr;
exports.renderErrorFn=renderErrorFn;
exports.renderError=renderError;
exports.rejectFn=rejectFn;
exports.renderForbidden=renderForbidden;
exports.logErrorFn=logErrorFn;
exports.renderInfo=renderInfo;
