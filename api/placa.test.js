'use strict';
/*
 * Sem rede: o fetch global é substituído. Não chama a Fraga.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('./placa.js');
const { _internals } = handler;

const SECRET = 'senha-teste-fraga';
const USER = 'conta@example.com';

function resetState() {
  _internals.hits.clear();
  assert.equal(typeof _internals.resetFragaToken, 'function');
  _internals.resetFragaToken();
}

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

function sampleData() {
  // Forma de r["data"] no script: vehicleByPlate + agregação de peças (esta é ignorada).
  return {
    vehicleByPlate: {
      brand: 'VW',
      madeYear: 2018,
      color: 'PRATA',
      models: [
        { name: 'FOX 1.6 MSI', engines: ['1.6'] },
        { name: 'OUTRO', engines: ['2.0'] }
      ]
    },
    catalogSearchByPlateAggregateBy: [{ id: '1', name: 'Filtros', total: 3, value: 'FILTRO' }]
  };
}

test('mapeia vehicleByPlate do Fraga para o formato dos outros provedores', () => {
  const map = _internals.mapFragaVehicle;
  assert.equal(typeof map, 'function');
  const data = sampleData();
  assert.deepEqual(map('ABC1D23', data), {
    placa: 'ABC1D23',
    marca: 'Volkswagen',
    modelo: 'Fox 1.6 Msi',
    ano: '2018',
    motorizacao: '1.6',
    combustivel: ''
  });
  assert.deepEqual(map('ABC1D23', { data }), map('ABC1D23', data));
});

test('junta a lista de motores, cai no texto do modelo e não devolve cor nem peças', () => {
  const map = _internals.mapFragaVehicle;
  const listed = map('ABC1234', {
    vehicleByPlate: {
      brand: 'GM',
      madeYear: '2020',
      color: 'PRETA',
      models: [{ name: 'ONIX 1.0', engines: ['1.0', '1.0 Turbo'] }]
    }
  });
  assert.equal(listed.marca, 'Chevrolet');
  assert.equal(listed.modelo, 'Onix 1.0');
  assert.equal(listed.ano, '2020');
  assert.equal(listed.motorizacao, '1.0 / 1.0 Turbo');
  assert.equal(listed.combustivel, '');
  assert.deepEqual(Object.keys(listed).sort(), ['ano', 'combustivel', 'marca', 'modelo', 'motorizacao', 'placa']);

  const fromName = map('ABC1234', {
    vehicleByPlate: { brand: 'FIAT', madeYear: 2014, models: [{ name: 'UNO 1.0', engines: [] }] }
  });
  assert.equal(fromName.marca, 'Fiat');
  assert.equal(fromName.modelo, 'Uno 1.0');
  assert.equal(fromName.motorizacao, '1.0');

  const asString = map('ABC1D23', {
    vehicleByPlate: { brand: 'FORD', madeYear: 2016, models: [{ name: 'KA', engines: '1.0 12V' }] }
  });
  assert.equal(asString.motorizacao, '1.0 12V');
  assert.equal(map('ABC1D23', { vehicleByPlate: null }), null);
  assert.equal(map('ABC1D23', { data: { vehicleByPlate: null } }), null);
});

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); },
    end(s) { this.body = s; }
  };
}

async function withFetch(fetchImpl, fn) {
  const prevFetch = global.fetch;
  const prevErr = console.error;
  const prevEnv = {
    PLATE_PROVIDER: process.env.PLATE_PROVIDER,
    PLATE_API_KEY: process.env.PLATE_API_KEY,
    FRAGA_USER: process.env.FRAGA_USER
  };
  const logs = [];
  global.fetch = fetchImpl;
  console.error = (...args) => { logs.push(args.map(a => String(a)).join(' ')); };
  try {
    return await fn(logs);
  } finally {
    global.fetch = prevFetch;
    console.error = prevErr;
    for (const k of Object.keys(prevEnv)) {
      if (prevEnv[k] == null) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
  }
}

test('reaproveita o token e, no 401, pede outro e repete a consulta', async () => {
  resetState();
  process.env.PLATE_PROVIDER = 'fraga';
  process.env.FRAGA_USER = USER;
  process.env.PLATE_API_KEY = SECRET;
  const calls = [];
  let graphqlTries = 0;
  const vehicle = {
    data: {
      vehicleByPlate: {
        brand: 'VW',
        madeYear: 2019,
        models: [{ name: 'GOL', engines: ['1.6'] }]
      }
    }
  };
  await withFetch(async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body, headers: opts && opts.headers });
    if (String(url).includes('/token')) {
      return jsonResponse(200, { access_token: 'tok-' + calls.length, expires_in: 3600 });
    }
    graphqlTries += 1;
    if (graphqlTries === 1) return jsonResponse(401, { errors: [{ message: 'token expirado' }] });
    return jsonResponse(200, vehicle);
  }, async () => {
    const first = await _internals.PROVIDERS.fraga.lookup('ABC1D23', SECRET);
    assert.deepEqual(first, {
      placa: 'ABC1D23',
      marca: 'Volkswagen',
      modelo: 'Gol',
      ano: '2019',
      motorizacao: '1.6',
      combustivel: ''
    });
    const tokenCallsAfterFirst = calls.filter(c => c.url.includes('/token')).length;
    assert.equal(tokenCallsAfterFirst, 2);
    const before = Date.now();
    assert.ok(_internals.fragaToken.exp >= before + (3600 - 20) * 1000 - 1000);
    assert.ok(_internals.fragaToken.exp <= before + (3600 - 20) * 1000 + 1000);

    await _internals.PROVIDERS.fraga.lookup('ABC1D23', SECRET);
    const tokenCallsAfterSecond = calls.filter(c => c.url.includes('/token')).length;
    assert.equal(tokenCallsAfterSecond, 2);

    const tokenReq = calls.find(c => c.url.includes('/token'));
    assert.match(tokenReq.url, /accounts\.fraga\.com\.br\/realms\/cat_autozone\/protocol\/openid-connect\/token$/);
    const form = new URLSearchParams(tokenReq.body);
    assert.equal(form.get('grant_type'), 'password');
    assert.equal(form.get('client_id'), 'catalog-user');
    assert.equal(form.get('scope'), 'openid');
    assert.equal(form.get('username'), USER);
    assert.equal(form.get('password'), SECRET);
    const gql = calls.find(c => c.url.includes('graphql'));
    assert.equal(gql.url, 'https://bff.catalogofraga.com.br/gateway/graphql');
    assert.equal(gql.headers.Origin, 'https://autozone.catalogofraga.com.br');
    assert.match(gql.headers.Authorization, /^Bearer tok-/);
    const q = JSON.parse(gql.body);
    assert.equal(q.operationName, 'GetVehicleByPlate');
    assert.equal(q.variables.plate, 'ABC1D23');
    assert.match(q.query, /vehicleByPlate/);
    assert.match(q.query, /brand/);
    assert.match(q.query, /madeYear/);
    assert.match(q.query, /engines/);
    assert.doesNotMatch(q.query, /catalogSearchByPlateAggregateBy/);
    assert.equal(JSON.stringify(q).includes(SECRET), false);
  });
});

test('falha de login do Fraga volta erro genérico, sem detalhe nem segredo', async () => {
  resetState();
  const calls = [];
  const logsBox = [];
  await withFetch(async (url) => {
    calls.push(String(url));
    return jsonResponse(401, { error: 'invalid_grant', error_description: 'Invalid user credentials ' + SECRET });
  }, async (logs) => {
    logsBox.push(...logs);
    process.env.PLATE_PROVIDER = 'fraga';
    process.env.FRAGA_USER = USER;
    process.env.PLATE_API_KEY = SECRET;
    const res = mockRes();
    await handler({ method: 'GET', query: { p: 'ABC1D23' }, headers: { 'x-forwarded-for': '203.0.113.9' } }, res);
    const json = JSON.parse(res.body);
    assert.equal(res.statusCode, 502);
    assert.equal(json.code, 'provider_error');
    assert.match(json.error, /autentic/i);
    const blob = res.body + '\n' + logs.join('\n');
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes(USER), false);
    assert.equal(blob.includes('invalid_grant'), false);
    assert.equal(blob.includes('Invalid user credentials'), false);
    assert.equal(calls.length, 1);
    await assert.rejects(
      () => _internals.PROVIDERS.fraga.lookup('ABC1D23', SECRET),
      (err) => err && err.kind === 'auth' && !String(err.message).includes('invalid_grant')
    );
  });
});

test('sem FRAGA_USER a busca Fraga fica não configurada e não chama a rede', async () => {
  resetState();
  let called = false;
  await withFetch(async () => { called = true; throw new Error('não deveria consultar'); }, async () => {
    process.env.PLATE_PROVIDER = 'fraga';
    process.env.PLATE_API_KEY = SECRET;
    delete process.env.FRAGA_USER;
    const res = mockRes();
    await handler({ method: 'GET', query: { p: 'ABC1D23' }, headers: { 'x-forwarded-for': '203.0.113.10' } }, res);
    const json = JSON.parse(res.body);
    assert.equal(res.statusCode, 503);
    assert.equal(json.code, 'not_configured');
    assert.equal(called, false);
  });
});
