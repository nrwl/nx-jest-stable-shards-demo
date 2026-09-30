const leaf = require('./test-03383.leaf');

test('test-03383', () => {
  const expected = 'test-03383';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
