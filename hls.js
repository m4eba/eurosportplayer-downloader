const fs = require('fs');
const path = require('path');
const urlutil = require('url');
const util = require('util');
const m3u8Parser = require('m3u8-parser');
const exec = util.promisify(require('child_process').exec);
const { spawn } = require('child_process');

const rmFile = util.promisify(fs.unlink);

let STORAGE = 'tmp';


function getVideoUrl(manifest) {
  let best = null;
  let result = null;
  const list = manifest.playlists;
  for (let i = 0; i < list.length; ++i) {
    const entry = list[i];
    if (!entry.attributes.RESOLUTION) continue;
    if (best !== null && best > entry.attributes.BANDWIDTH) continue;
    best = entry.attributes.BANDWIDTH;
    result = entry.uri;
  }
  return result;
}

function getAudioUrl(manifest, language) {
  if (manifest.mediaGroups.AUDIO === null) return null;
  if (manifest.mediaGroups.AUDIO.audio_0 === null) return null;

  const map = manifest.mediaGroups.AUDIO.audio_0;
  for (let key in map) {
    let entry = map[key];
    console.log('entry', entry);
    if (entry.language === language) {
      return entry.uri;
    }
  }
  return null;
}

function download_playlist(base, url, filename) {
  const uri = urlutil.resolve(base, url);
  const output = path.join(STORAGE, filename);
  const args = [
    '-y',
    `-i`, uri,
    '-c', 'copy',
    output
  ];
  console.log(args);

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', args);
    ffmpeg.stderr.on('data', (data) => {
      //console.log(data.toString('utf8'));
      process.stdout.write(data);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.log(`ffmpeg code ${code}`);
      }
      resolve();
    });
  });
}

async function join(filename) {
  let command = 'ffmpeg ';
  command += ` -i ${path.join(STORAGE, 'video.ts')} `;
  command += ` -i ${path.join(STORAGE, 'audio.ts')} `;
  command += ' -c:v copy -c:a copy ';
  command += ` "${filename}" `;

  console.log(command);
  const { stdout, stderr } = await exec(command);
  // TODO error handling
  console.log(stdout);
  console.log(stderr);
}

async function download(params, filename, args) {

  let uri = new URL(params.url);
  let base = uri.protocol + '//' + uri.host + path.parse(uri.pathname).dir + '/';
  console.log('base', base);

  if (args.tmp) {
    STORAGE = args.tmp;
    if (!STORAGE.endsWith(path.sep)) {
      STORAGE += path.sep;
    }
  }

  const parser = new m3u8Parser.Parser();
  parser.push(params.m3u8);
  parser.end();

  let videoUrl = getVideoUrl(parser.manifest);
  let audioUrl = getAudioUrl(parser.manifest, args.language);

  if (videoUrl === null) {
    console.log('videourl not found');
    process.exit(1);
  }
  if (audioUrl === null) {
    console.log('audio url not found');
    process.exit(1);
  }


  await Promise.all([
    download_playlist(base, videoUrl, 'video.ts'),
    download_playlist(base, audioUrl, 'audio.ts')
  ]);

  await join(filename);

  if (!args['keep-tmp-files']) {
    await rmFile(path.join(STORAGE, 'video.ts'));
    await rmFile(path.join(STORAGE, 'audio.ts'));
  }
}

module.exports = download;