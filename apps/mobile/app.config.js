// Complementa o app.json. O push ao supervisor (Firebase) só entra no APK se o arquivo google-services.json estiver
// aqui em apps/mobile: sem ele o build segue normal, só que sem push (veja docs/app_android.md, "Push ao supervisor").
const fs = require('node:fs')
const path = require('node:path')

module.exports = ({ config }) => {
  const hasFirebase = fs.existsSync(path.join(__dirname, 'google-services.json'))
  return hasFirebase ? { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } } : config
}
