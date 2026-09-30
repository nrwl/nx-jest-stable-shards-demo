const leaf = require('./test-00003.leaf');

test('test-00003', () => {
  const expected = 'test-00003';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
