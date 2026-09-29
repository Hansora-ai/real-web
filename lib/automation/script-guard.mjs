// Small models sometimes slip a Georgian letter into an Armenian word (for example "մոդელներ" for
// "մոդելներ"). Inside words that are mostly Armenian, replace Georgian letters with the Armenian letter
// for the same sound. Words written entirely in Georgian (a Georgian-speaking business) are left alone.
const GEORGIAN_TO_ARMENIAN = {
  'ა': 'ա', 'ბ': 'բ', 'გ': 'գ', 'დ': 'դ', 'ე': 'ե', 'ვ': 'վ', 'ზ': 'զ', 'თ': 'թ', 'ი': 'ի', 'კ': 'կ', 'ლ': 'լ',
  'მ': 'մ', 'ნ': 'ն', 'ო': 'ո', 'პ': 'պ', 'ჟ': 'ժ', 'რ': 'ր', 'ს': 'ս', 'ტ': 'տ', 'უ': 'ու', 'ფ': 'փ', 'ქ': 'ք',
  'ღ': 'ղ', 'ყ': 'կ', 'შ': 'շ', 'ჩ': 'չ', 'ც': 'ց', 'ძ': 'ձ', 'წ': 'ծ', 'ჭ': 'ճ', 'ხ': 'խ', 'ჯ': 'ջ', 'ჰ': 'հ'
};
const ARMENIAN = /[Ա-և]/g;
const GEORGIAN = /[ა-ჿ]/g;

export function fixMixedScript(text) {
  return String(text ?? '').replace(/[Ա-ևა-ჿ]+/g, word => {
    const armenian = (word.match(ARMENIAN) || []).length;
    const georgian = (word.match(GEORGIAN) || []).length;
    if (!georgian || armenian < georgian) return word;
    return word.replace(GEORGIAN, letter => GEORGIAN_TO_ARMENIAN[letter] || '');
  });
}
