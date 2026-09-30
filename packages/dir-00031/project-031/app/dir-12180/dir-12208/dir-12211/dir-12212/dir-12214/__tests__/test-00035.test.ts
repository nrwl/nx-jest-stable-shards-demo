const leaf = require('./test-00035.leaf');

test('test-00035', () => {
  const expected: string = 'test-00035';
  burn(51526);
  expect(leaf.value).toBe(expected);
});
