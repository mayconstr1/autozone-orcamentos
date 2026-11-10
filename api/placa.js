'use strict';
/*
 * GET /api/placa?p=ABC1D23
 * Ponte server-side para um provedor de consulta de placa.
 * Configuração (variáveis de ambiente do projeto na Vercel):
 *   PLATE_PROVIDER = apiplacas | dadosapi | fraga
 *   PLATE_API_KEY  = token/chave do provedor (NUNCA vai para o front); no fraga, a senha
 *   FRAGA_USER     = e-mail da conta do Catálogo Fraga (só para PLATE_PROVIDER=fraga)
 * Resposta normalizada: {placa, marca, modelo, ano, motorizacao, combustivel}
 * Nenhum dado de proprietário, chassi, renavam etc. é devolvido ou guardado.
 */

const RATE_LIMIT = 10;          // consultas por IP
const RATE_WINDOW_MS = 60000;   // por minuto
const TIMEOUT_MS = 8000;
const hits = new Map();         // memória da instância (limite simples, best-effort)

const OLD_RE = /^[A-Z]{3}[0-9]{4}$/;          // AAA9999
const MERCOSUL_RE = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/; // AAA9A99

function normalizePlate(raw) {
  return String(raw == null ? '' : raw).toUpperCase().replace(/[\s\-.]/g, '');
}
function isValidPlate(p) { return OLD_RE.test(p) || MERCOSUL_RE.test(p); }

function clientIp(req) {
  const h = (req && req.headers) || {};
  const xf = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(h['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateLimited(ip, now = Date.now()) {
  if (hits.size > 5000) { for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k); }
  let e = hits.get(ip);
  if (!e || now - e.start > RATE_WINDOW_MS) { e = { start: now, count: 0 }; hits.set(ip, e); }
  e.count++;
  return e.count > RATE_LIMIT ? Math.ceil((e.start + RATE_WINDOW_MS - now) / 1000) : 0;
}

/* ---------- helpers de normalização ---------- */
const s = v => (v == null ? '' : String(v)).trim();
const pick = (o, keys) => { if (!o || typeof o !== 'object') return ''; for (const k of keys) { const v = s(o[k]); if (v) return v; } return ''; };
const titleCase = str => s(str).toLowerCase().replace(/(^|[\s\-\/])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
const BRANDS = { 'VW': 'Volkswagen', 'VOLKS': 'Volkswagen', 'VOLKSWAGEN': 'Volkswagen', 'GM': 'Chevrolet', 'CHEV': 'Chevrolet', 'CHEVROLET': 'Chevrolet', 'MB': 'Mercedes-Benz', 'M.BENZ': 'Mercedes-Benz', 'MERCEDES BENZ': 'Mercedes-Benz', 'MMC': 'Mitsubishi', 'LR': 'Land Rover', 'BMW': 'BMW', 'BYD': 'BYD', 'CAOA CHERY': 'Caoa Chery', 'JAC': 'JAC', 'RAM': 'RAM' };
function niceBrand(b) {
  let x = s(b).toUpperCase().replace(/^I\s*\//, '').trim(); // "I/" = importado
  if (!x) return '';
  return BRANDS[x] || titleCase(x);
}
function engineFromText(t) {
  const m = s(t).match(/(?:^|[\s\/])(\d\.\d)(?=$|[\s\/A-Z])/i);
  return m ? m[1] : '';
}
function engineFromCc(cc) {
  const n = Number(String(cc == null ? '' : cc).replace(',', '.'));
  if (!isFinite(n) || n < 50 || n > 20000) return '';
  return (Math.round(n / 100) / 10).toFixed(1);
}
function fuelNice(f) {
  const x = s(f).toUpperCase();
  if (!x) return '';
  if (/ALCOOL\s*\/\s*GASOLINA|GASOLINA\s*\/\s*ALCOOL|FLEX/.test(x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return 'Flex';
  return titleCase(x.toLowerCase());
}
function buildEngine({ cc, text, power, explicit }) {
  let e = s(explicit) || engineFromCc(cc) || engineFromText(text);
  const p = Number(power);
  if (e && isFinite(p) && p >= 30 && p <= 2000 && !/cv/i.test(e)) e += ' ' + Math.round(p) + ' cv';
  return e;
}
function clean(o) {
  // whitelist: somente estes campos saem daqui
  return { placa: s(o.placa), marca: s(o.marca), modelo: s(o.modelo), ano: s(o.ano), motorizacao: s(o.motorizacao), combustivel: s(o.combustivel) };
}
function unwrap(j) {
  if (j && typeof j === 'object') for (const k of ['data', 'dados', 'resultado', 'result', 'veiculo']) if (j[k] && typeof j[k] === 'object' && !Array.isArray(j[k])) return j[k];
  return j;
}

class ProviderError extends Error { constructor(kind, status) { super(kind); this.kind = kind; this.status = status; } }

async function fetchJson(url, opts) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  let r;
  try { r = await fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {})); }
  catch (e) { throw new ProviderError('network', 0); }
  finally { if (t) clearTimeout(t); }
  let body = null; try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body };
}

/* ---------- provedores ---------- */
const PROVIDERS = {
  // API Placas (apiplacas.com.br) — doc: GET https://wdapi2.com.br/v3/basico/{placa}, Authorization: Bearer
  apiplacas: {
    async lookup(placa, key) {
      const { status, body } = await fetchJson('https://wdapi2.com.br/v3/basico/' + encodeURIComponent(placa), {
        method: 'GET', headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }
      });
      const code = body && s(body.codigo);
      if (status === 404 || code === 'placa_nao_encontrada') throw new ProviderError('not_found', status);
      if (status === 400 && code === 'placa_invalida') throw new ProviderError('invalid', status);
      if (status !== 200 || !body || body.error === true) throw new ProviderError('provider', status);
      const blk = body.basico || {};
      if (blk.error === true) throw new ProviderError(/encontr/i.test(s(blk.message)) ? 'not_found' : 'provider', status);
      const d = blk.dados || unwrap(blk) || {};
      const modelo = pick(d, ['modelo', 'marca_modelo', 'marcaModelo', 'versao']);
      const out = clean({
        placa,
        marca: niceBrand(pick(d, ['marca'])),
        modelo: titleCase(modelo.replace(/^.*?\//, '')),
        ano: pick(d, ['ano_modelo', 'anoModelo', 'ano']),
        motorizacao: buildEngine({ explicit: pick(d, ['motorizacao']), cc: pick(d, ['cilindradas', 'cilindrada']), power: pick(d, ['potencia']), text: modelo }),
        combustivel: fuelNice(pick(d, ['combustivel', 'descricao_combustivel', 'descricaoCombustivel']))
      });
      if (!out.marca && !out.modelo) throw new ProviderError('not_found', status);
      return out;
    }
  },
  // DadosAPI — doc: POST https://api.dadosapi.com/v1/veiculo-placa-completa, Bearer, body {"placa":"..."}
  dadosapi: {
    async lookup(placa, key) {
      const { status, body } = await fetchJson('https://api.dadosapi.com/v1/veiculo-placa-completa', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ placa })
      });
      if (status === 404) throw new ProviderError('not_found', status);
      if (status !== 200 || !body || body.error === true || body.erro === true) throw new ProviderError('provider', status);
      const d = unwrap(body) || {};
      const mm = pick(d, ['descricaoMarcaModelo', 'marcaModelo', 'codigoMarcaModelo']).replace(/^I\s*\//i, '');
      let marca = pick(d, ['marca']), modelo = pick(d, ['modelo']);
      if (!marca && mm.includes('/')) { marca = mm.split('/')[0]; modelo = modelo || mm.split('/').slice(1).join('/'); }
      else if (!marca && mm) { const parts = mm.split(/\s+/); marca = parts.shift(); modelo = modelo || parts.join(' '); }
      else if (!modelo) modelo = mm;
      const out = clean({
        placa,
        marca: niceBrand(marca),
        modelo: titleCase(modelo),
        ano: pick(d, ['anoModelo', 'ano_modelo', 'ano', 'anoFabricacao']),
        motorizacao: buildEngine({ cc: pick(d, ['cilindradas', 'cilindrada']), power: pick(d, ['potencia']), text: mm || modelo }),
        combustivel: fuelNice(pick(d, ['descricaoCombustivel', 'combustivel']))
      });
      if (!out.marca && !out.modelo) throw new ProviderError('not_found', status);
      return out;
    }
  },
  // Catálogo Fraga (conta AutoZone) — GraphQL em bff.catalogofraga.com.br, login Keycloak.
  // Env: PLATE_PROVIDER=fraga, FRAGA_USER=e-mail, PLATE_API_KEY=senha.
  fraga: {
    async lookup(placa, key) {
      const now = Date.now();
      if (!fragaToken.value || now >= fragaToken.exp) {
        // shortcut: grant "password" direto; se o Keycloak recusar (unauthorized_client),
        // trocar por fluxo authorization-code ou credencial de serviço da Fraga.
        const t = await fetchJson('https://accounts.fraga.com.br/realms/cat_autozone/protocol/openid-connect/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'password', client_id: 'catalog-user', scope: 'openid', username: s(process.env.FRAGA_USER), password: key }).toString()
        });
        if (t.status !== 200 || !t.body || !t.body.access_token) throw new ProviderError('login:' + s(t.body && t.body.error), t.status);
        fragaToken = { value: t.body.access_token, exp: now + ((Number(t.body.expires_in) || 60) - 20) * 1000 };
      }
      const { status, body } = await fetchJson('https://bff.catalogofraga.com.br/gateway/graphql', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + fragaToken.value, 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://autozone.catalogofraga.com.br' },
        body: JSON.stringify({ operationName: 'GetVehicleByPlate', query: 'query GetVehicleByPlate($plate: String!) { vehicleByPlate(plate: $plate) { brand madeYear models { name engines } } }', variables: { plate: placa } })
      });
      if (status === 401) fragaToken = { value: '', exp: 0 };
      const v = body && body.data && body.data.vehicleByPlate;
      if (status !== 200 || !body || (body.errors && !v)) throw new ProviderError(body && body.data && body.errors ? 'not_found' : 'provider', status);
      const m = (v && Array.isArray(v.models) && v.models[0]) || {};
      const out = clean({
        placa,
        marca: niceBrand(v && v.brand),
        modelo: titleCase(m.name),
        ano: v && v.madeYear,
        motorizacao: s(Array.isArray(m.engines) ? m.engines[0] : ''),
        combustivel: ''
      });
      if (!out.marca && !out.modelo) throw new ProviderError('not_found', status);
      return out;
    }
  }
};
let fragaToken = { value: '', exp: 0 }; // reaproveitado enquanto a instância estiver quente

function send(res, status, obj, extra) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (extra) for (const k in extra) res.setHeader(k, extra[k]);
  res.end(JSON.stringify(obj));
}

async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido.', code: 'method_not_allowed' }, { Allow: 'GET' });
  let p = req.query && req.query.p;
  if (p == null) { try { p = new URL(req.url, 'http://x').searchParams.get('p'); } catch (e) { p = ''; } }
  const placa = normalizePlate(Array.isArray(p) ? p[0] : p);
  if (!isValidPlate(placa)) return send(res, 400, { error: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.', code: 'invalid_plate' });

  const providerName = s(process.env.PLATE_PROVIDER).toLowerCase();
  const key = s(process.env.PLATE_API_KEY);
  const provider = PROVIDERS[providerName];
  if (!provider || !key) return send(res, 503, { error: 'busca por placa não configurada', code: 'not_configured' });

  const wait = rateLimited(clientIp(req));
  if (wait) return send(res, 429, { error: 'Muitas buscas seguidas. Aguarde um minuto e tente de novo.', code: 'rate_limited' }, { 'Retry-After': String(wait) });

  try {
    const data = await provider.lookup(placa, key);
    return send(res, 200, data);
  } catch (e) {
    const kind = e && e.kind;
    if (kind === 'not_found') return send(res, 404, { error: 'Placa não encontrada.', code: 'not_found' });
    if (kind === 'invalid') return send(res, 400, { error: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.', code: 'invalid_plate' });
    // log mínimo, sem chave nem corpo da resposta do provedor
    console.error('placa: provider error', providerName, (e && e.status) || '', kind || 'exception');
    return send(res, 502, { error: 'Não foi possível consultar a placa agora. Tente novamente em instantes.', code: 'provider_error' });
  }
}

module.exports = handler;
module.exports._internals = { normalizePlate, isValidPlate, rateLimited, hits, PROVIDERS, engineFromCc, engineFromText, niceBrand, fuelNice, RATE_LIMIT };
