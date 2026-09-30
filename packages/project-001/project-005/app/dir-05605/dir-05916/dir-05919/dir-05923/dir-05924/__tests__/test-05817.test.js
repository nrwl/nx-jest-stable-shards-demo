const leaf = require('./test-05817.leaf');

test('test-05817', () => {
  const expected = 'test-05817';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
