const leaf = require('./test-00653.leaf');

test('test-00653', () => {
  const expected = 'test-00653';
  burn(2293);
  expect(leaf.value).toBe(expected);
});
