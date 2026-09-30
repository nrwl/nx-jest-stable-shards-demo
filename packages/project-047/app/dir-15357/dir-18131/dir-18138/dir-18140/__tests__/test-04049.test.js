const leaf = require('./test-04049.leaf');

test('test-04049', () => {
  const expected = 'test-04049';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
