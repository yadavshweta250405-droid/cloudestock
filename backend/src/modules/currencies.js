import { validate } from '../core/validate.js';
import { notFound, conflict } from '../core/errors.js';

export function createService(ctx) {
  const { db } = ctx;

  const svc = {
    list() {
      return db.all('SELECT * FROM currencies ORDER BY is_default DESC, code ASC');
    },

    get(code) {
      const cur = db.get('SELECT * FROM currencies WHERE code = ?', [code.toUpperCase()]);
      if (!cur) throw notFound('Currency');
      return cur;
    },

    updateRate(code, rate, user) {
      if (rate <= 0) throw conflict('Exchange rate must be greater than zero');
      const cur = svc.get(code);
      db.run('UPDATE currencies SET exchange_rate = ?, updated_at = ? WHERE code = ?', [rate, new Date().toISOString(), cur.code]);
      ctx.activity.log(user, 'currency.rate', 'currency', null, `Currency ${cur.code} exchange rate updated to ${rate}`);
      ctx.changed('currencies');
      return svc.get(cur.code);
    },

    setDefault(code, user) {
      return db.transaction(() => {
        const cur = svc.get(code);
        db.run('UPDATE currencies SET is_default = 0');
        db.run('UPDATE currencies SET is_default = 1, updated_at = ? WHERE code = ?', [new Date().toISOString(), cur.code]);
        ctx.activity.log(user, 'currency.default', 'currency', null, `Default base currency set to ${cur.code} (${cur.symbol})`);
        ctx.changed('currencies');
        return svc.list();
      });
    }
  };

  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.currencies;

  router.get('/api/currencies', () => ({ items: s.list() }));

  router.patch('/api/currencies/:code', { perm: 'warehouse:write' }, (r) => {
    const d = validate(r.body, { exchangeRate: { type: 'number', required: true } });
    return s.updateRate(r.params.code, d.exchangeRate, r.user);
  });

  router.post('/api/currencies/set-default', { perm: 'warehouse:write' }, (r) => {
    const d = validate(r.body, { code: { type: 'string', required: true } });
    return s.setDefault(d.code, r.user);
  });
}
