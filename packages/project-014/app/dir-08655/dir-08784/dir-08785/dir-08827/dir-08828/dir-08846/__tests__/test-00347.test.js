const leaf = require('./test-00347.leaf');

test('test-00347', () => {
  const expected = 'test-00347';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
