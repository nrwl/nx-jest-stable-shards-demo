const leaf = require('./test-00005.leaf');

test('test-00005', () => {
  const expected = 'test-00005';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
