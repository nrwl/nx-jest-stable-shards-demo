const leaf = require('./test-05164.leaf');

test('test-05164', () => {
  const expected = 'test-05164';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
