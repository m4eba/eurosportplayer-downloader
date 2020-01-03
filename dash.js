const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const URL = require('url').URL;
const util = require('util');
const parseString = util.promisify(require('xml2js').parseString);
const exec = util.promisify(require('child_process').exec);

const rmFile = util.promisify(fs.unlink);
const writeFile = util.promisify(fs.writeFile);

let STORAGE = 'tmp/';

// Select the representation with highest bitrate
function select_representation(Media) {
  let best_bandwidth = 0;
  let result;
  for (let key in Media['Representation']) {
    let value = Media['Representation'][key];
    let bandwidth = value['$']['bandwidth'];

    if (parseInt(bandwidth) > best_bandwidth) {
      best_bandwidth = parseInt(bandwidth);
      result = value;
    }
  }
  return result;
}

function processAdaptionSet(adapSet) {
  let obj = {};
  const rep = select_representation(adapSet);
  obj.id = rep['$']['id'];
  obj.segments = [];
  obj.segmentIdx = 0;
  obj.done = false;


  const init = rep.SegmentTemplate[0].$.initialization;
  const media = rep.SegmentTemplate[0].$.media;

  obj.segments.push({
    url: init.replace('$RepresentationID$', obj.id)
  });

  let time;
  let count = 0;
  rep.SegmentTemplate[0].SegmentTimeline[0].S.forEach(function (timeline) {
    if (timeline.$.t) {
      time = parseInt(timeline.$.t);
    }
    let repeat = 0;
    if (timeline.$.r) {
      repeat = parseInt(timeline.$.r);
    }

    console.log('SegmentTimeline');
    console.log(timeline);

    for (let i = 0; i <= repeat; ++i) {
      let url = media.replace('$RepresentationID$', obj.id);
      url = url.replace('$Time$', time);
      url = url.replace('$Number$', ++count);
      console.log('add url', url);
      obj.segments.push({
        url: url
      });
      time += parseInt(timeline.$.d);
      console.log('new time', time);
    }
  });

  return obj;
}

function createStream(media, ext) {
  media.filename = "presentation_" + media.id + ext;
  media.outstream = fs.createWriteStream(STORAGE + media.filename);
}

async function fetch_segments(dash_base, media) {

  for (let i = 0; i < media.segments.length; ++i) {
    let url = media.segments[i].url;
    console.log('fetch', i, url);

    let res = await fetch(dash_base + url);
    let buf = await res.buffer();

    media.outstream.write(buf);
  }
}


async function decrypt(media, key) {
  let command = '';
  command += 'mp4decrypt ';
  command += '--key 1:' + key + ' '
  command += STORAGE + media.filename + ' ';
  command += STORAGE + 'decrypted_' + media.filename;

  console.log(command);
  const { stdout, stderr } = await exec(command);
  // TODO error handling
  console.log(stdout);
  console.log(stderr);
}

async function join(video, audio, filename) {
  let command = 'ffmpeg ';
  command += '-i ' + STORAGE + 'decrypted_' + video.filename + ' ';
  command += '-i ' + STORAGE + 'decrypted_' + audio.filename + ' ';
  command += '-c:v copy -c:a copy ';
  command += '"' + filename + '"';

  console.log(command);
  const { stdout, stderr } = await exec(command);
  // TODO error handling
  console.log(stdout);
  console.log(stderr);
}

async function download(url, filename, key, args) {
  let res = await fetch(url);
  let mpd = await res.text();

  let uri = new URL(url);
  let dash_base = uri.protocol + '//' + uri.host + uri.pathname;
  console.log('base', dash_base);

  if (args.tmp) {
    STORAGE = args.tmp;
    if (!STORAGE.endsWith(path.sep)) {
      STORAGE += path.sep;
    }
  }

  const xml = await parseString(mpd);
  try {
    const Period = xml['MPD']['Period'];
    //input_dash_base = Period[0]['BaseURL'];//[0];
    const adaptationSets = Period[0]['AdaptationSet'];

    console.log('period duartion', Period[0].$.duration);

    let audioSet = null;
    let videoSet = null;
    let processing = null;

    for (let k in adaptationSets) {
      const value = adaptationSets[k];
      
      processing = value['$']['mimeType'];

      if (processing.startsWith('video')) {
        videoSet = value;
      }
      if (processing.startsWith('audio')) {
        if ( value['$']['lang'] === args.language ) {
          audioSet = value;
        }
      }
    }
    if ( audioSet === null ) {
      console.log('language not found ',args.language);
      process.exit(1);
    }

    const audio = processAdaptionSet(audioSet);
    const video = processAdaptionSet(videoSet);

    createStream(video, '.m4v');
    createStream(audio, '.m4a');

    const debug = {
      filename: filename,
      key: key,
      mpd: xml
    }
    await writeFile(STORAGE + 'debug.json', JSON.stringify(debug, null, '  '), { encoding: 'utf8' });

    await Promise.all([
      fetch_segments(dash_base, video),
      fetch_segments(dash_base, audio)
    ]);

    await decrypt(video, key);
    await decrypt(audio, key);

    await join(video, audio, filename);

    await rmFile(STORAGE + video.filename);
    await rmFile(STORAGE + 'decrypted_' + video.filename);
    await rmFile(STORAGE + audio.filename);
    await rmFile(STORAGE + 'decrypted_' + audio.filename);
    await rmFile(STORAGE + 'debug.json');
  } catch (e) {
    console.log(e);
    throw new Error('unable to process mpd ' + e);
  }
}

module.exports = download;