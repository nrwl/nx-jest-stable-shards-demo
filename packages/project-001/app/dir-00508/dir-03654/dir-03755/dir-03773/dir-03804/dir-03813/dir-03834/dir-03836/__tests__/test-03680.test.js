const leaf = require('./test-03680.leaf');

test('test-03680', () => {
  const expected = 'test-03680';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
