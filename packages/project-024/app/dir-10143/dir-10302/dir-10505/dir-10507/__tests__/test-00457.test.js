const leaf = require('./test-00457.leaf');

test('test-00457', () => {
  const expected = 'test-00457';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
