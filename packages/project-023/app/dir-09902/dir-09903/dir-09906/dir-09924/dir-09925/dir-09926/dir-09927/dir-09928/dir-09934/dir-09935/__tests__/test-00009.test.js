const leaf = require('./test-00009.leaf');

test('test-00009', () => {
  const expected = 'test-00009';
  burn(26991);
  expect(leaf.value).toBe(expected);
});
