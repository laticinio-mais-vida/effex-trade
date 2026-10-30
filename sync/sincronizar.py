"""Sincroniza os clientes do ERP com o EFFEX Trade.

Lê a tabela CLIENTES da cópia do banco do ERP (Firebird 2.1, só leitura) e manda a lista inteira para o servidor,
num pacote compactado e assinado com HMAC-SHA256 da hora do envio e do hash do conteúdo (o mesmo esquema do BI Mais
Vida). A chave fica no config.ini e na SYNC_KEY do servidor e nunca trafega.

O servidor cadastra os clientes novos, atualiza os que mudaram e inativa os que saíram do ERP. A localização
(latitude e longitude) também vem do ERP, até alguém editá-la no painel ou pela planilha: a editada não muda mais.

Uso: dois cliques em sincronizar-clientes.bat, ou: python sincronizar.py [--forcar]
"""
from __future__ import annotations

import argparse
import configparser
import datetime as dt
import gzip
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

PASTA = Path(__file__).resolve().parent
ROTA = "/sync/clientes"
# LATITUDADE (assim mesmo, no ERP) e LONGITUDE são a localização do cliente; a de entrega só entra quando ela falta
CONSULTA = ("SELECT ID_CLIENTE, NOME, RAZAOSOCIAL, CIDADE, ESTADO, INATIVO, LATITUDADE, LONGITUDE, "
            "LATITUDEENTREGA, LONGITUDEENTREGA FROM CLIENTES")
# Cópia do banco mais velha que isso ganha um aviso (a sincronização segue)
DIAS_COPIA_VELHA = 2


class Problema(Exception):
    """Erro com uma mensagem para quem rodou a sincronização."""

    def __init__(self, mensagem: str, codigo: str | None = None):
        super().__init__(mensagem)
        self.codigo = codigo


def registrar(texto: str) -> None:
    """Uma linha por execução em sincronizar.log, para conferir depois."""
    try:
        with open(PASTA / "sincronizar.log", "a", encoding="utf-8") as f:
            f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {texto}\n")
    except OSError:
        pass


def ler_config() -> configparser.ConfigParser:
    arquivo = PASTA / "config.ini"
    if not arquivo.exists():
        raise Problema(f"falta o arquivo {arquivo}: copie o config.exemplo.ini para config.ini e preencha")
    ini = configparser.ConfigParser(interpolation=None)
    ini.read(arquivo, encoding="utf-8")
    return ini


def conferir_destino(destino: str, chave: str) -> None:
    if not chave:
        raise Problema("falta a chave em [envio] no config.ini (é a SYNC_KEY do servidor)")
    u = urlparse(destino)
    if u.scheme != "https" and not (u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")):
        raise Problema(f"o destino em [envio] precisa começar com https:// ({destino or 'vazio'})")


def ativo(inativo) -> bool:
    """INATIVO do ERP: 0 ou vazio = ativo."""
    if inativo is None:
        return True
    if isinstance(inativo, str):
        return inativo.strip().upper() not in ("1", "S", "T", "Y")
    return int(inativo) == 0


def texto(valor, limite: int) -> str | None:
    return (valor or "").strip()[:limite] or None


def ponto(lat, lng) -> tuple[float, float] | None:
    """Coordenada preenchida (0 nas duas conta como vazia). A conferência dos limites fica no servidor."""
    if lat is None or lng is None:
        return None
    lat, lng = float(lat), float(lng)
    return None if lat == 0 and lng == 0 else (lat, lng)


def ler_clientes(ini: configparser.ConfigParser) -> tuple[list[dict], dt.datetime]:
    from fb import BancoSomenteLeitura  # só aqui: o fdb e o Firebird só são necessários para ler o banco

    b = ini["banco"]
    arquivo = Path(b.get("arquivo", "").strip())
    if not arquivo.is_file():
        raise Problema(f"a cópia do banco não está em {arquivo} (confira [banco] arquivo no config.ini)")
    senha = b.get("senha", "").strip()
    if not senha or senha == "COLOQUE_A_SENHA_AQUI":
        raise Problema("falta a senha do banco em [banco] no config.ini")
    # Data da cópia: a criação do arquivo. A de modificação não serve, porque o Firebird regrava o cabeçalho do .GDB
    # a cada conexão (inclusive as do BI); no Windows, st_ctime é a criação
    st = arquivo.stat()
    copia = dt.datetime.fromtimestamp(getattr(st, "st_birthtime", st.st_ctime)).astimezone()
    try:
        with BancoSomenteLeitura(str(arquivo), b.get("usuario", "SYSDBA"), senha, host=b.get("host", "localhost"),
                                 fbclient=b.get("fbclient") or None, codificacao=b.get("codificacao", "cp1252")) as bd:
            linhas = bd.consulta(CONSULTA)
    except Exception as e:
        raise Problema(f"falha ao ler o banco: {e}\n  Confira se o serviço 'Firebird Server - DefaultInstance' está rodando "
                       "e se a cópia do banco terminou de ser gravada.") from None
    clientes = []
    for id_cliente, nome, razao, cidade, uf, inativo, lat, lng, lat_entrega, lng_entrega in linhas:
        if id_cliente is None or int(id_cliente) <= 0:
            continue
        p = ponto(lat, lng) or ponto(lat_entrega, lng_entrega)
        clientes.append({"erpId": int(id_cliente), "name": texto(nome, 200), "legalName": texto(razao, 200),
                         "city": texto(cidade, 120), "state": texto(uf, 20), "active": ativo(inativo),
                         "latitude": p[0] if p else None, "longitude": p[1] if p else None})
    if not clientes:
        raise Problema("a tabela CLIENTES veio vazia: a cópia do banco está completa?")
    return clientes, copia


def enviar(destino: str, chave: str, corpo: bytes) -> dict:
    data = str(int(time.time()))
    assinatura = hmac.new(chave.encode(), f"{data}\n{hashlib.sha256(corpo).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(destino + ROTA, data=corpo, method="POST", headers={
        "Content-Type": "application/gzip",
        "User-Agent": "EffexTrade-sincronizacao/1.0",
        "X-Effex-Data": data,
        "X-Effex-Assinatura": assinatura,
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            erro = json.loads(e.read())
        except Exception:
            erro = {}
        raise Problema(f"o servidor recusou o envio ({e.code}): {erro.get('error') or e.reason}", erro.get("code")) from None
    except urllib.error.URLError as e:
        raise Problema(f"sem conexão com {destino}: {e.reason}") from None


def main() -> int:
    parser = argparse.ArgumentParser(description="Sincroniza os clientes do ERP com o EFFEX Trade.")
    parser.add_argument("--forcar", action="store_true",
                        help="confirma quando muitos clientes ficariam inativos de uma vez (o servidor pede confirmação)")
    args = parser.parse_args()

    print("EFFEX Trade - sincronização dos clientes com o ERP\n")
    try:
        ini = ler_config()
        destino = ini.get("envio", "destino", fallback="").strip().rstrip("/")
        chave = ini.get("envio", "chave", fallback="").strip()
        conferir_destino(destino, chave)

        print("Lendo os clientes da cópia do banco...")
        clientes, copia = ler_clientes(ini)
        ativos = sum(c["active"] for c in clientes)
        com_ponto = sum(1 for c in clientes if c["active"] and c["latitude"] is not None)
        print(f"  {len(clientes)} clientes no ERP ({ativos} ativos, {com_ponto} deles com localização). "
              f"Cópia do banco de {copia:%d/%m/%Y às %H:%M}.")
        if dt.datetime.now().astimezone() - copia > dt.timedelta(days=DIAS_COPIA_VELHA):
            print(f"  Atenção: a cópia do banco tem mais de {DIAS_COPIA_VELHA} dias.")

        pacote = {"sourceModifiedAt": copia.isoformat(timespec="seconds"), "clients": clientes}
        if args.forcar:
            pacote["force"] = True
        corpo = gzip.compress(json.dumps(pacote, ensure_ascii=False).encode("utf-8"))
        print(f"Enviando para {destino} ({len(corpo) / 1024:.0f} KB)...")
        r = enviar(destino, chave, corpo)
    except Problema as e:
        print(f"\nNÃO SINCRONIZOU: {e}")
        if e.codigo == "MUITOS_INATIVADOS":
            print("\nSe estiver certo (os clientes saíram mesmo do ERP), rode de novo confirmando:\n"
                  "  sincronizar-clientes.bat --forcar")
        registrar(f"ERRO  {e}")
        return 1

    print("\nSincronização concluída:")
    print(f"  {r['created']} novos, {r['updated']} alterados, {r['inactivated']} inativados, {r['reactivated']} reativados")
    if r.get("linked"):
        print(f"  {r['linked']} ligados a clientes que já estavam cadastrados no EFFEX")
    if r.get("located"):
        print(f"  {r['located']} localizações vindas do ERP (novas ou atualizadas)")
    if r.get("keptManual"):
        print(f"  {r['keptManual']} localizações editadas no painel mantidas (o ERP tem outra)")
    print(f"  {r['unchanged']} sem alteração")
    if r.get("unlocated"):
        print(f"  {r['unlocated']} clientes ativos ainda sem localização: preencha no painel, em Clientes")
    for aviso in r.get("warnings", []):
        print(f"  Aviso: {aviso}")
    registrar(f"OK    {r['total']} clientes: {r['created']} novos, {r['updated']} alterados, {r['inactivated']} inativados, "
              f"{r['reactivated']} reativados, {r.get('linked', 0)} ligados, {r.get('located', 0)} localizações do ERP, "
              f"{r.get('keptManual', 0)} do painel mantidas ({destino})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
