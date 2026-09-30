const leaf = require('./test-05223.leaf');

test('test-05223', () => {
  const expected = 'test-05223';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
