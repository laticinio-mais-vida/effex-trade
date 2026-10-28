/** Erro de negócio com status HTTP, código estável (para o app tratar) e detalhes opcionais. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, code = 'REQUISICAO_INVALIDA', details?: unknown) => new HttpError(400, message, code, details)
export const unauthorized = (message = 'Sessão expirada ou inválida. Faça login novamente.') => new HttpError(401, message, 'NAO_AUTENTICADO')
export const forbidden = (message = 'Seu perfil não tem acesso a este recurso.', code = 'SEM_PERMISSAO') => new HttpError(403, message, code)
export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`, 'NAO_ENCONTRADO')
export const conflict = (message: string, code = 'CONFLITO', details?: unknown) => new HttpError(409, message, code, details)
/** Regra de negócio violada (cerca eletrônica, fotos obrigatórias, etc.). */
export const ruleViolation = (message: string, code: string, details?: unknown) => new HttpError(422, message, code, details)
