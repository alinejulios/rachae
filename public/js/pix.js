// Pix: validação de chaves e geração do BR Code estático ("Pix Copia e Cola" /
// QR Code), seguindo o Manual de Padrões para Iniciação do Pix do Banco Central
// (padrão EMV® QRCPS-MPM). Módulo puro, sem DOM.
//
// Campos do BR Code usados (ID + tamanho com 2 dígitos + valor):
//   00 Payload Format Indicator = "01"
//   26 Merchant Account Information – Pix
//        00 GUI = "br.gov.bcb.pix"
//        01 chave Pix
//   52 Merchant Category Code = "0000"
//   53 Moeda = "986" (BRL)
//   54 Valor (opcional, ex.: "123.45")
//   58 País = "BR"
//   59 Nome de quem recebe (até 25 caracteres — limite do padrão; nomes maiores são
//      abreviados por nomeParaQR, e o banco de quem paga mostra o nome oficial da conta)
//   60 Cidade de quem recebe (até 15 caracteres)
//   62 Dados adicionais → 05 txid (até 25; "***" quando não há identificador)
//   63 CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), 4 dígitos hexadecimais
//
// Observação: o BR Code não tem campo de CPF. O CPF só aparece quando ELE é a chave.

export const TIPOS_CHAVE = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  telefone: 'Celular',
  email: 'Email',
  aleatoria: 'Chave aleatória'
};

const soDigitos = s => String(s || '').replace(/\D/g, '');

export function cpfValido(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(cnpj) {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = n => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/**
 * Normaliza a chave no formato que o DICT/BCB usa e valida.
 * @returns {{ chave: string } | { erro: string }}
 */
export function normalizarChave(tipo, valor) {
  const v = String(valor || '').trim();
  switch (tipo) {
    case 'cpf':
      return cpfValido(v) ? { chave: soDigitos(v) } : { erro: 'CPF inválido. Confira os números.' };
    case 'cnpj':
      return cnpjValido(v) ? { chave: soDigitos(v) } : { erro: 'CNPJ inválido. Confira os números.' };
    case 'telefone': {
      // Formato do Pix: +55 + DDD + número (ex.: +5511999998888)
      let d = soDigitos(v);
      if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
      if (!(d.length === 10 || d.length === 11) || /^0/.test(d)) {
        return { erro: 'Celular inválido. Use DDD + número, ex.: (11) 99999-8888.' };
      }
      return { chave: '+55' + d };
    }
    case 'email': {
      const e = v.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77 ? { chave: e } : { erro: 'Email inválido.' };
    }
    case 'aleatoria': {
      const e = v.toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e)
        ? { chave: e } : { erro: 'Chave aleatória inválida (formato: 8-4-4-4-12 letras e números).' };
    }
    default:
      return { erro: 'Escolha o tipo da chave.' };
  }
}

/** Mostra a chave de um jeito legível (e mascara o CPF, que é dado pessoal). */
export function chaveLegivel(tipo, chave) {
  if (tipo === 'cpf') return '***.' + chave.slice(3, 6) + '.' + chave.slice(6, 9) + '-**';
  if (tipo === 'cnpj') return chave.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (tipo === 'telefone') return chave.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  return chave;
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos; corta no tamanho máximo. */
export function textoPix(s, max) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .slice(0, max).trim();
}

const PARTICULAS = ['da', 'de', 'do', 'das', 'dos', 'e'];

/**
 * Encaixa um nome completo nos 25 caracteres do BR Code sem perder a identificação:
 * 1) tira partículas (da, de, do, das, dos, e); 2) abrevia os nomes do meio, da direita
 * para a esquerda (mantém sempre o primeiro e o último); 3) só então corta.
 * Ex.: "Laysla Isabella Pereira de Oliveira" → "Laysla I P Oliveira".
 */
export function nomeParaQR(nome, max = 25) {
  const limpo = textoPix(nome, 200);
  if (limpo.length <= max) return limpo;
  let partes = limpo.split(' ').filter(p => !PARTICULAS.includes(p.toLowerCase()));
  if (partes.length < 2) return limpo.slice(0, max).trim();
  const junta = () => partes.join(' ');
  for (let i = partes.length - 2; i >= 1 && junta().length > max; i--) partes[i] = partes[i][0];
  return junta().length <= max ? junta() : junta().slice(0, max).trim();
}

const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

export function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Gera o "Pix Copia e Cola" (é o mesmo texto que vai dentro do QR Code).
 * @param {{chave:string, nome:string, cidade:string, valor?:number, txid?:string}} p
 */
export function payloadPix({ chave, nome, cidade, valor, txid }) {
  const nomeOk = nomeParaQR(nome, 25);
  const cidadeOk = textoPix(cidade, 15);
  if (!chave) throw new Error('Chave Pix ausente.');
  if (!nomeOk) throw new Error('Nome de quem recebe ausente.');
  if (!cidadeOk) throw new Error('Cidade de quem recebe ausente.');
  const id = (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***';

  let p = campo('00', '01')
    + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave))
    + campo('52', '0000')
    + campo('53', '986');
  if (valor && valor > 0) p += campo('54', (Math.round(valor * 100) / 100).toFixed(2));
  p += campo('58', 'BR')
    + campo('59', nomeOk)
    + campo('60', cidadeOk)
    + campo('62', campo('05', id))
    + '6304';
  return p + crc16(p);
}
