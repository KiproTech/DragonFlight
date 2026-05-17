/* ============================================================
   DRAGON FLIGHT — Supabase Client
   supabase.js  (included in every page)
   ============================================================ */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPA_URL  = 'https://rwtezncoukiekayxuxje.supabase.co';
export const SUPA_ANON = 'sb_publishable_9JwkSoI9zm2oXu6tvZDRaw_2ebdCWtE';

export const sb = createClient(SUPA_URL, SUPA_ANON);

/* Currency config — $0.50 minimum deposit */
export const CURRENCIES = {
  KES: { symbol:'KES ', rate:130,   minDep:65,    flag:'🇰🇪', name:'Kenyan Shilling' },
  UGX: { symbol:'UGX ', rate:3700,  minDep:1850,  flag:'🇺🇬', name:'Ugandan Shilling' },
  TZS: { symbol:'TZS ', rate:2700,  minDep:1350,  flag:'🇹🇿', name:'Tanzanian Shilling' },
  NGN: { symbol:'₦',    rate:1600,  minDep:800,   flag:'🇳🇬', name:'Nigerian Naira' },
  GHS: { symbol:'GH₵',  rate:15,    minDep:7.5,   flag:'🇬🇭', name:'Ghanaian Cedi' },
  ZAR: { symbol:'R',    rate:19,    minDep:9.5,   flag:'🇿🇦', name:'South African Rand' },
  RWF: { symbol:'RWF ', rate:1350,  minDep:675,   flag:'🇷🇼', name:'Rwandan Franc' },
  ETB: { symbol:'ETB ', rate:57,    minDep:29,    flag:'🇪🇹', name:'Ethiopian Birr' },
  USD: { symbol:'$',    rate:1,     minDep:0.5,   flag:'🇺🇸', name:'US Dollar' },
  GBP: { symbol:'£',    rate:0.79,  minDep:0.40,  flag:'🇬🇧', name:'British Pound' },
  EUR: { symbol:'€',    rate:0.92,  minDep:0.46,  flag:'🇪🇺', name:'Euro' },
  INR: { symbol:'₹',    rate:83,    minDep:41.5,  flag:'🇮🇳', name:'Indian Rupee' },
};

export const COUNTRY_CURRENCY = {
  KE:'KES', UG:'UGX', TZ:'TZS', RW:'RWF', ET:'ETB',
  NG:'NGN', GH:'GHS', SN:'XOF', CI:'XOF', ZA:'ZAR',
  ZM:'ZMW', ZW:'USD', US:'USD', GB:'GBP', IN:'INR',
};