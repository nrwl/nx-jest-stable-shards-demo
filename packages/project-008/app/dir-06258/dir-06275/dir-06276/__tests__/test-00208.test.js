const leaf = require('./test-00208.leaf');

test('test-00208', () => {
  const expected = 'test-00208';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
