const leaf = require('./test-00245.leaf');

test('test-00245', () => {
  const expected = 'test-00245';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
