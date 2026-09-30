const leaf = require('./test-05698.leaf');

test('test-05698', () => {
  const expected = 'test-05698';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
