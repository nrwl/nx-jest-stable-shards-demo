const leaf = require('./test-03972.leaf');

test('test-03972', () => {
  const expected = 'test-03972';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
