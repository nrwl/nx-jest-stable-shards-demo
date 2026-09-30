const leaf = require('./test-00592.leaf');

test('test-00592', () => {
  const expected = 'test-00592';
  burn(2148);
  expect(leaf.value).toBe(expected);
});
