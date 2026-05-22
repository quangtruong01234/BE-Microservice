export const zaloPayConfig = {
  appId: Number(process.env.ZALOPAY_APP_ID) || 2553,
  key1: process.env.ZALOPAY_KEY1 || 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL',
  key2: process.env.ZALOPAY_KEY2 || 'kLtgPl8HHhfvMuDHPwKfgfsY4Ydm9eIz',
  endpoint: process.env.ZALOPAY_ENDPOINT || 'https://sb-openapi.zalopay.vn/v2',
};