/**
 * Created by lzw on 14-8-8.
 */

var open=!__production;
//var open=true;

function startWith(s,prefix,f){
  if(s.indexOf(prefix)==0){
    f.call();
  }
}

function filterFn(s,f){
  startWith(s,'',f);
  //f.call();
}

function logError(error){
  error=util.inspect(error);
  log(error);
}

function log(s){
  s=s+'';
  if(open){
    filterFn(s,function(){
      console.log(s);
    });
  }
}

exports.log=log;
exports.logError=logError;