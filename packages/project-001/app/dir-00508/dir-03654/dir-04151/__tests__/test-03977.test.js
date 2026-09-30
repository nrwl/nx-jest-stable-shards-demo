const leaf = require('./test-03977.leaf');

test('test-03977', () => {
  const expected = 'test-03977';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
