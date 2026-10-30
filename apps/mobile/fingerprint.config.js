// Fingerprint = runtimeVersion do EAS Update: uma atualização só chega aos APKs com o mesmo fingerprint.
// A lista substitui a do preset padrão ("balanced"): os seis primeiros itens são os dele, os dois últimos (scripts do
// package.json e .gitignore) não mexem na parte nativa e, sem eles aqui, pediriam um APK novo à toa.
// Mudar este arquivo muda o fingerprint: só junto com um APK novo.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: [
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'ExpoConfigVersions',
    'ExpoConfigRuntimeVersionIfString',
    'EasJson',
    'Easignore',
    'AutolinkingConfigPaths',
    'PackageJsonScriptsAll',
    'GitIgnore',
  ],
}
