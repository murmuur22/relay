"""Deterministic remaining-path audit; scratch only, no Linux receipts."""
import contextlib, gzip, io, os, tarfile, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import control_plane_upgrade_069 as c
import coordinator_069 as m
from test_control_plane_cli_069 import Fixture
HERE=Path(os.environ['TMPDIR'])

class CloseoutTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name); self.f=Fixture(self.root)
 def swap_on_pin(self,path,redirect):
  original=c.pinned; swapped=[]
  @contextlib.contextmanager
  def pin(p,*a,**kw):
   with original(p,*a,**kw) as fd:
    if Path(p)==path and not swapped:
     swapped.append(1); path.rename(path.with_name(path.name+'-held')); path.symlink_to(redirect,target_is_directory=True)
    yield fd
  return patch.object(c,'pinned',pin)
 def test_migration_root_parent_replaced_before_mkdir_no_redirect(self):
  f=self.f; parent=f.l.p(m.MIGRATIONS).parent; redirect=self.root/'redirect'; redirect.mkdir()
  with self.swap_on_pin(parent,redirect):
   try: m.migration_root(f.l)
   except (OSError,c.Refused): pass
  self.assertEqual(list(redirect.iterdir()),[],'no migration root created through replaced parent')
 def test_lock_parent_replaced_before_create_no_redirect(self):
  parent=self.root/'locks'; parent.mkdir(); redirect=self.root/'redirect'; redirect.mkdir()
  with self.swap_on_pin(parent,redirect):
   with self.assertRaises((OSError,c.Refused)):
    with m.exclusive(self.f.l,parent/'migration.lock'): pass
  self.assertEqual(list(redirect.iterdir()),[])
  self.assertEqual(list(self.root.joinpath('locks-held').iterdir()),[],'refuse BEFORE creating even under held descriptor')
 def test_marker_parent_replaced_before_create_refuses_before_write(self):
  f=self.f; parent=f.l.marker.parent; redirect=self.root/'redirect'; redirect.mkdir()
  h=m.Host(f.l,f.s,{},self.root/'tx')
  with self.swap_on_pin(parent,redirect):
   with self.assertRaises((OSError,c.Refused)): h.gate()
  self.assertEqual(list(redirect.iterdir()),[])
  self.assertEqual(list(parent.with_name(parent.name+'-held').iterdir()),[])
 def test_marker_unlink_replaced_ancestor_preserves_foreign_marker(self):
  f=self.f; parent=f.l.marker.parent; redirect=self.root/'redirect'; redirect.mkdir()
  h=m.Host(f.l,f.s,{},self.root/'tx'); h.gate(); (redirect/'maintenance').write_bytes(h.mark)
  original=f.l.read; swapped=[]
  def read(path,*a,**kw):
   value=original(path,*a,**kw)
   if Path(path)==f.l.marker and not swapped:
    swapped.append(1); parent.rename(self.root/'marker-held'); parent.symlink_to(redirect,target_is_directory=True)
   return value
  with patch.object(f.l,'read',read),patch.object(h,'stop'),patch.object(h,'stopped_idle'),patch.object(h,'preserved'),patch.object(h,'start'),patch.object(h,'health'):
   try: h.release('new')
   except (OSError,c.Refused): pass
  self.assertTrue((redirect/'maintenance').is_file(),'must not unlink redirect even if bytes match')
 def test_gzip_input_link_parent_refused(self):
  parent=self.root/'input'; parent.mkdir(); (parent/'archive.gz').write_bytes(gzip.compress(b'valid'))
  alias=self.root/'alias'; alias.symlink_to(parent,target_is_directory=True)
  with self.assertRaises((OSError,c.Refused)): m.bounded_gzip(alias/'archive.gz')
 def test_extract_replaced_work_parent_no_redirected_creation(self):
  f=self.f; work=self.root/'work'; work.mkdir(mode=0o700); redirect=self.root/'redirect'; redirect.mkdir()
  original=m.bounded_gzip
  def swap(path,*a,**kw):
   value=original(path,*a,**kw); work.rename(self.root/'work-held'); work.symlink_to(redirect,target_is_directory=True)
   # A matching archive at the redirect must not make it a trusted work root.
   (redirect/'relay-updater-linux-x64.tar.gz').write_bytes(f.archive.read_bytes())
   return value
  with patch.object(m,'bounded_gzip',swap):
   with self.assertRaises((OSError,c.Refused)): m.verified_candidate(f.l,f.release,work,f.manifest_sha,f.source)
  self.assertFalse((redirect/'candidate').exists(),'no candidate mkdir through redirected work root')
 def test_archive_parent_case_collision_and_traversal_no_services(self):
  f=self.f
  for name in ('../escape','A/one','updater/../../escape'):
   with self.subTest(name=name):
    entry=tarfile.TarInfo(name); entry.size=0
    if name=='A/one': f.payload['a/two']=b'collision'
    f.make_release(entry)
    with self.assertRaises(c.Refused): m.apply(f.l,f.s,f.args())
    f.payload.pop('a/two',None)
    self.assertEqual(f.mutations(),[]); self.assertFalse(f.l.marker.exists())
 def test_existing_public_migration_root_not_adopted(self):
  root=self.f.l.p(m.MIGRATIONS); root.mkdir(mode=0o755)
  with self.assertRaises(c.Refused): m.migration_root(self.f.l)
  self.assertEqual(root.stat().st_mode & 0o777,0o755)
 def test_release_input_symlink_and_hardlink_refused(self):
  f=self.f; dest=self.root/'dest'; dest.mkdir()
  alias=self.root/'alias'; alias.symlink_to(f.release,target_is_directory=True)
  with self.assertRaises((OSError,c.Refused)): m.copy_protected(f.l,alias/'relay-release.json',dest/'a',1024**2)
  os.link(f.release/'relay-release.json',self.root/'hard')
  with self.assertRaises((OSError,c.Refused)): m.copy_protected(f.l,self.root/'hard',dest/'b',1024**2)
  self.assertEqual(list(dest.iterdir()),[])

if __name__=='__main__': unittest.main(verbosity=2)
