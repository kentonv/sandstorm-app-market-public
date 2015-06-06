spkFS = new FS.Store.FileSystem('spkFS', {path: 'uploads/spks'});

Spks = new FS.Collection('spks', {
  stores: [
    spkFS
    ],
  filter: {
    maxSize: 500 * 1024 * 1024, // in bytes
    allow: {
      extensions: ['spk']
    },
    onInvalid: function (message) {
      console.log(message);
    }
  }
});

Spks.spkFolder = 'spks/';

Spks.allow({
  insert: function(userId, doc) {
    return true;
  },
  update: function(userId, doc, fieldNames, modifier) {
    return true;
  },
  remove: function(userId, doc) {
    return true;
  },
  download:function(){
    return true;
  }
});

Spks.error = {
  'BAD_SPK': function() {
    return 'Upload failed - ' + this.original.name + ' does not appear to be a valid .spk';
  },
  'DUPLICATE_SPK': function() {
    return 'That .spk corresponds to a version which has already been uploaded to the App Store';
  },
  'NON_LATEST_VERSION': function() {
    return 'That .spk corresponds to version ' + this.meta.version + ', and a more recent version already ' +
           'exists in the App Store';
  }
};

if (Meteor.isServer) {

  var gcloud = Meteor.npmRequire('gcloud'),
      GCS = new gcloud.storage({
        keyFilename: './assets/app/' + Meteor.settings.GCSKeyFilename,
        projectId: Meteor.settings.GCSProjectId
      }),
      gcsBucket = GCS.bucket(Meteor.settings.public.spkBucket);

  Meteor.publish('spks', function(fileId) {
    return Spks.find({$or: [{_id: fileId}, {'meta.appId': fileId}]});
  });

  Spks.find().observeChanges({
    changed: function(id, fields) {
      if (fields.copies && fields.copies.spkFS) {
        var doc = Spks.findOne(id);
        if (!doc.meta) {
          try {
            var packageMeta = App.spkVerify('uploads/spks/' + fields.copies.spkFS.key),
                existing = Apps.findOne({'versions.packageId': packageMeta.packageId}),
                latest = Spks.findOne({'meta.appId': packageMeta.appId}, {sort: {'meta.version': -1}}),
                update = {meta: packageMeta};
            if (existing) update.error = 'DUPLICATE_SPK';
            if (latest && latest.meta.version > packageMeta.version) update.error = 'NON_LATEST_VERSION';
            Spks.update(id, {$set: update});

            if (!update.error) {
              gcsBucket.upload(spkFS.path + '/' + doc.copies.spkFS.key, {
                destination: Spks.spkFolder + doc.copies.spkFS.key
              }, Meteor.bindEnvironment(function(err, file) {
                if (err) throw err;
                Spks.update(id, {$set: {
                  location: Meteor.settings.public.spkBucket + '.storage.googleapis.com/' + Spks.spkFolder + doc.copies.spkFS.key
                }});
              }));
            }
          } catch(e) {
            console.log(e);
            Spks.update(id, {$set: {error: 'BAD_SPK'}});
          }
        }
      }
    }
  });

  Spks.getLocation = function(id) {

    if (id && id._id) id = id._id;
    var spk = Spks.findOne(id);
    return spk && ('http://' + Meteor.settings.public.spkBucket + '.storage.googleapis.com/' + Spks.spkFolder + spk.copies.spkFS.key);

  };

  Spks.getKey = function(id) {

    if (id && id._id) id = id._id;
    var spk = Spks.findOne(id);
    return spk && (Spks.spkFolder + spk.copies.spkFS.key);

  };

  JsonRoutes.add('get', '/package/:packageId', function(req, res, next) {

    var packageId = req.params.packageId,
        app = Apps.findOne({'versions.packageId': packageId});

    if (app) {

      res.writeHead(200, {
        'Content-Disposition': 'attachment; filename=download.spk',
      });
      var spkFile = gcsBucket.file(app.spkKey);
      spkFile.createReadStream().pipe(res);

    } else {

      JsonRoutes.sendResults(res, 400, 'cannot find packageId ' + packageId);

    }

  });

}
