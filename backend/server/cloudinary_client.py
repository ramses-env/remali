import os
import cloudinary
import cloudinary.uploader
from cloudinary.utils import cloudinary_url

def _configure():
    url = os.environ.get('CLOUDINARY_URL')
    if url:
        os.environ['CLOUDINARY_URL'] = url
        cloudinary.config(secure=True)
        return
    cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME')
    api_key = os.environ.get('CLOUDINARY_API_KEY')
    api_secret = os.environ.get('CLOUDINARY_API_SECRET')
    if cloud_name and api_key and api_secret:
        cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret, secure=True)

_configure()

def upload_image(source, public_id=None, folder=None, overwrite=True, resource_type='image'):
    options = {}
    if public_id:
        options['public_id'] = public_id
    if folder:
        options['folder'] = folder
    preset = os.environ.get('CLOUDINARY_UPLOAD_PRESET')
    if preset:
        options['upload_preset'] = preset
    options['overwrite'] = overwrite
    options['resource_type'] = resource_type
    return cloudinary.uploader.upload(source, **options)

def build_url(public_id, **transforms):
    return cloudinary_url(public_id, **transforms)[0]
