const leaf = require('./test-00434.leaf');

test('test-00434', () => {
  const expected = 'test-00434';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
