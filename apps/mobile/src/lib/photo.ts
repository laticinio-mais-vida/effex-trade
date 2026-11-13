import { File as FsFile } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import type { ImagePickerAsset } from 'expo-image-picker'

/** Lado maior da foto enviada: o mesmo limite com que a API guarda (MAX_SIDE em apps/api/src/services/photo-stamp.ts). */
export const PHOTO_MAX_SIDE = 2048
/** Compressão JPEG da foto reduzida (0 a 1). A API grava de novo em 85 depois do carimbo. */
const PHOTO_COMPRESS = 0.8

/**
 * Reduz a foto da câmera antes do envio. A câmera entrega a resolução inteira (12 a 50 MP, de 2 a 8 MB), que pela
 * internet de dentro da loja levava perto de um minuto para subir, e a API reduzia para 2048 px de qualquer jeito.
 * Reduzida aqui, a foto fica com uns 300 a 600 KB e a mesma resolução que fica guardada.
 *
 * A imagem é decodificada já no tamanho final (não carrega os 50 MP na memória) e com a orientação do EXIF aplicada
 * nos pixels, então chega em pé no servidor. Se a redução falhar, segue a foto original, como antes.
 */
export async function shrinkPhoto(asset: ImagePickerAsset): Promise<ImagePickerAsset> {
  try {
    const context = ImageManipulator.manipulate(asset.uri, { maxWidth: PHOTO_MAX_SIDE, maxHeight: PHOTO_MAX_SIDE })
    const image = await context.renderAsync()
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_COMPRESS })
    image.release()
    context.release()
    // A original fica no cache do app; sem ela, não acumulam megabytes por foto ao longo do dia
    try {
      new FsFile(asset.uri).delete()
    } catch {}
    return { ...asset, uri: saved.uri, width: saved.width, height: saved.height, mimeType: 'image/jpeg', fileSize: undefined, exif: undefined }
  } catch {
    return asset
  }
}
