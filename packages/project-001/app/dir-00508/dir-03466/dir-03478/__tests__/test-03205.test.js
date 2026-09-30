const leaf = require('./test-03205.leaf');

test('test-03205', () => {
  const expected = 'test-03205';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
