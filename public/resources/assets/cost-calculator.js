/* Optional local arithmetic. No network requests, storage, cookies, or billing. */
(function () {
  'use strict';
  const form = document.getElementById('cost-calculator');
  const output = document.getElementById('calculator-result');
  if (!form || !output) return;
  const format = n => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const fixed = Number(values.get('fixed'));
    const attempt = Number(values.get('attempt'));
    const attempts = Number(values.get('attempts'));
    const assets = Number(values.get('assets'));
    if (![fixed, attempt, attempts, assets].every(Number.isFinite) || fixed < 0 || attempt <= 0 || attempts < 1 || assets < 0 || !Number.isInteger(assets)) {
      output.textContent = 'Enter nonnegative costs and a whole number of assets. Attempt cost must be greater than zero; attempts per approved asset must be at least one.';
      return;
    }
    const perAsset = attempt * attempts;
    const consumption = perAsset * assets;
    const breakEven = fixed / perAsset;
    const difference = consumption - fixed;
    const comparison = Math.abs(difference) < 1e-9
      ? 'Both cost the same in this simplified example.'
      : difference > 0
        ? 'Consumption spending is ' + format(difference) + ' units above the fixed subscription.'
        : 'Consumption spending is ' + format(-difference) + ' units below the fixed subscription.';
    output.textContent = format(perAsset) + ' units per approved asset; ' + format(consumption) + ' units in monthly consumption spending; break-even at approximately ' + format(breakEven) + ' approved assets per month. ' + comparison + ' This assumes the subscription covers equivalent work and excludes extra costs.';
  });
}());
