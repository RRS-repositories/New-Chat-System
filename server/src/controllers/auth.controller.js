import { wrap } from '../middleware/errors.js';
import { forwardLogin } from '../services/crmLogin.service.js';

export function createAuthController({ crmInternalUrl, fetchImpl = fetch }) {
  return {
    login: wrap(async (req, res) => {
      const { email, password, captchaToken, captchaAnswer } = req.body || {};
      const clientIp = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '')
        .split(',')[0]
        .trim();
      const { status, body } = await forwardLogin(
        { crmInternalUrl, fetchImpl },
        {
          credentials: { email, password, captchaToken, captchaAnswer },
          clientIp,
          userAgent: String(req.headers['user-agent'] || 'chat2'),
        },
      );
      res.status(status).json(body);
    }),
  };
}
