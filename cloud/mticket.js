/**
 * Created by lzw on 14-8-8.
 */
var Counter = AV.Object.extend('Counter');
var mutil = require('cloud/mutil.js');
var mlog=require('cloud/mlog.js');

function findTicketCounter() {
  var p=new AV.Promise();
  var q = new AV.Query(Counter);
  q.equalTo('name', 'Ticket');
  q.first().then(function (c) {
    if(c){
      p.resolve(c);
    }else{
      var cc=new Counter();
      cc.set('name','Ticket');
      cc.set('n',0);
      cc.save(function(cc){
        q.resolve(cc);
      },mutil.rejectFn(p));
    }
  },mutil.rejectFn(p));
  return p;
}

function findTicketN() {
  return findTicketCounter().then(function (c) {
    return AV.Promsie.as(c.get('n'));
  });
}

function incTicketN() {
  var p = new AV.Promise();
  findTicketCounter().then(function (c) {
    c.increment('n');
    c.save().then(function (c) {
      mlog.log(c.get('n'));
      p.resolve(c.get('n'));
    }, mutil.rejectFn(p));
  }, mutil.rejectFn(p));
  return p;
}

function incTicketNReturnOrigin(){
  var p=new AV.Promise();
  incTicketN().then(function(n){
    p.resolve(n-1);
  },mutil.rejectFn(p));
  return p;
}

exports.findTicketN = findTicketN;
exports.incTicketN = incTicketN;
exports.incTicketNReturnOrigin=incTicketNReturnOrigin;