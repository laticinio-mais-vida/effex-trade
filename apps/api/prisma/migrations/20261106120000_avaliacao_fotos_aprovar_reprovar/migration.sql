-- "Avaliar fotos" do painel deixa de dar nota e passa a aprovar ou reprovar, como o vendedor (PhotoAudit).
-- Toda foto que já tinha nota vira aprovada por quem deu a nota, qualquer que fosse a nota; a observação vira o
-- texto da aprovação. Se essa pessoa já tinha auditado a foto no app, vale a auditoria do app.
-- As colunas da nota (score, reviewNotes, reviewedById, reviewedAt) ficam no banco, sem uso, para a versão
-- anterior da API continuar funcionando se for preciso voltar.
INSERT INTO "PhotoAudit" ("id", "photoId", "auditorId", "status", "justification", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  p."reviewedById",
  'APROVADA'::"AuditStatus",
  NULLIF(btrim(p."reviewNotes"), ''),
  COALESCE(p."reviewedAt", CURRENT_TIMESTAMP),
  COALESCE(p."reviewedAt", CURRENT_TIMESTAMP)
FROM "Photo" p
WHERE p."score" IS NOT NULL AND p."reviewedById" IS NOT NULL
ON CONFLICT ("photoId", "auditorId") DO NOTHING;

-- A regra "Nota máxima das fotos" deixou de existir
DELETE FROM "Setting" WHERE "key" = 'photoScoreMax';
DELETE FROM "PromotorSetting" WHERE "key" = 'photoScoreMax';
