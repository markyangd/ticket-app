var app = require("cloud/app.js");

var moment = require('moment');
var _ = require('underscore');
var todo_status = app.todo_status;
var processing_status = app.processing_status;
var done_status = app.done_status;
var mlog = require('cloud/mlog.js');

AV.Cloud.beforeSave('Ticket', function (req, res) {
  console.log(req.object);
  res.success();
});

AV.Cloud.define("ClearProcessing_timer", function (req, res) {
  console.log("Clear precessing list.");
  var query = new AV.Query("Ticket");
  query.equalTo('status', processing_status);
  query.limit(1000);
  query.descending("createdAt");
  var clearN = 0;
  var info = '';
  query.find().then(function (tickets) {
    tickets = tickets || [];
    var outPromises = [];
    _.each(tickets, function (t) {
      var querythread = new AV.Query("Thread");
      querythread.descending("createdAt");
      querythread.limit(1);
      querythread.equalTo("ticket", AV.Object.createWithoutData("Ticket", t.id));
      var outPromise = querythread.find().then(function (threads) {
        threads = threads || [];
        var th;
        if (threads.length > 0) {
          th = threads[0];
          var lastday = moment(new Date()).diff(moment(th.createdAt), 'days');
          info += lastday + '  ';
          if (lastday >= 8) {
            t.set('status', done_status);
            clearN++;
            console.log('Clear Ticket ' + t.id + ' title=' + t.get('title'));
            app.sendCloseEmail(t);
            return t.save();
          }
        }
        return AV.Promise.as();
      });
      outPromises.push(outPromise);
    }, res.error);
    return AV.Promise.when(outPromises);
  }, res.error).then(function () {
    var msg = clearN + ' tickets are cleared !';
    console.log(msg);
    res.success(msg);
  });
});

AV.Cloud.define("NotifyReply", function (req, res) {
  mlog.log('NotifyReply');
  var q = new AV.Query("Ticket");
  q.equalTo('status', todo_status);
  q.ascending("updatedAt");
  q.find().then(function (tickets) {
    var p = AV.Promise.as(false);
    mlog.log(tickets.length);
    for (var i = 0; i < tickets.length; i++) {
      mlog.log('index='+i);
      var t = tickets[i];
      p = p.then(function (res) {
        if(res){
          return AV.Promise.as(true);
        }
        var promise = new AV.Promise();
        var tQ = new AV.Query('Thread');
        tQ.equalTo('ticket', t);
        tQ.descending('createdAt');
        tQ.first().then(function (th) { // th is undefined when the ticket is created just now
          if (!th || th.get('notify') != true) {
            var last,c;
            if(th){
              last=th.createdAt;
              c=th.get('content');
            }else{
              last= t.createdAt;
              c= t.get('content');
            }
            var date = new Date().toLocaleString();
            var time = moment(date).diff(last);
            var tTime = app.transfromTime(time);
            app.notifyTicketToChat(t, c, '用户已经等待了' + tTime + '！');
            console.log('Notify hipchat ' + tTime);
            if(th){
              th.set('notify', true);
              mlog.log('set time to' + date);
              th.save().then(function () {
                promise.resolve(true);
              });
            }else{
              promise.resolve(true);
            }
          } else {
            promise.resolve(false);
          }
        });
        return promise;
      });
    }
    p.then(function(){
      res.success('ok');
    });
  });
});

AV.Cloud.onVerified('email',function(){
});
